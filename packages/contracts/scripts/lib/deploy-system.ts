/**
 * The single source of truth for how a NoxStream system is deployed and wired.
 *
 * Both `scripts/deploy.ts` (real Sepolia) and the unit tests (local Nox stack
 * in Docker) call `deployNoxStreamSystem`, so the thing the tests exercise is
 * the thing that gets deployed. Deployment order is fixed by the dependency
 * graph:
 *
 *   payout asset (real ERC-20 if supplied, else MockUSDC)
 *     -> ConfidentialPayoutToken   (ERC-7984 wrapper over the payout asset)
 *     -> <Chosen>StreamAdapter     (public aggregate stream)
 *     -> NoxPayrollRegistry        (encrypted roster)
 *     -> NoxStreamPayroll          (accrual + confidential claim)
 *     -> registry.setPayroll(payroll)
 *     -> payroll.start()
 *
 * `registry.setPayroll` is not optional and not a convenience. NoxCompute
 * checks *the calling contract* against the ACL of every operand, and
 * `claim()` evaluates `rate * elapsed` inside NoxStreamPayroll — so the payroll
 * contract itself must hold a grant on each rate handle. Skip it and
 * `Nox.safeMul` reverts `NotAllowed` deep inside `claim()`, nowhere near the
 * `setAllocation` that actually caused it. It runs before any allocation is
 * written; writing it afterwards also works (it back-fills the whole roster),
 * but only the "before" order avoids a window where a claim would fail.
 *
 * The adapter/payroll pair is potentially mutually referential — the adapter
 * may want to know the vault it harvests into, and the payroll must know the
 * adapter. We resolve that with CREATE address pre-computation rather than a
 * post-hoc setter, so the deployment has no window in which a half-wired
 * contract is live. The predicted address is asserted against the real one.
 */
import { artifacts } from "hardhat";
import type { ChainType, NetworkConnection } from "hardhat/types/network";
import { getContractAddress, type Abi, type Address, type Hex } from "viem";
import {
  constructorInputs,
  findFunction,
  resolveConstructorArgs,
  type ArgCandidate,
} from "./abi.js";

export interface DeployOptions {
  /**
   * Real payout ERC-20 (e.g. Sepolia USDC). When omitted a MockUSDC is
   * deployed. A mock *payout asset on a testnet* is intended and honest — what
   * would not be acceptable is faking balances or results.
   */
  payoutAsset?: Address;
  /**
   * Underlying streaming-protocol core (Sablier Lockup). The adapter takes it
   * as a constructor argument rather than hardcoding a per-chain constant, so
   * the same bytecode works on any chain Sablier supports.
   *
   * Defaults to the verified Sepolia v4.0 deployment on chain 11155111.
   */
  sablierLockup?: Address;
  /**
   * Chain 31337 only: deploy `MockSablierLockup` when no real Lockup address is
   * available. Ignored (and refused) on every other chain — a live deployment
   * must compose with the real protocol.
   */
  allowLocalMockLockup?: boolean;
  /**
   * Wei to seed the adapter's fee tank with at construction. Sablier v3.0+
   * charges a native-token fee on every `withdraw`, and `IStreamAdapter.harvest`
   * is non-payable, so the adapter pays out of its own balance.
   */
  feeTankWei?: bigint;
  /** Seed mint for MockUSDC, ignored when `payoutAsset` is supplied. */
  mockMintAmount?: bigint;
  /** Extra addresses to seed with MockUSDC (the deployer always gets some). */
  mockMintTo?: Address[];
  confidentialTokenName?: string;
  confidentialTokenSymbol?: string;
  confidentialTokenURI?: string;
  /** Call the payroll's start function after wiring. */
  startPayroll?: boolean;
  log?: (message: string) => void;
}

export interface DeployedAddresses {
  payoutAsset: Address;
  confidentialPayoutToken: Address;
  payrollRegistry: Address;
  streamAdapter: Address;
  noxStreamPayroll: Address;
}

export interface DeployedSystem {
  deployer: Address;
  chainId: number;
  addresses: DeployedAddresses;
  txHashes: Record<string, Hex>;
  /** Resolved artifact names — the adapter's name is Agent B's choice. */
  contractNames: {
    payoutAsset: string;
    confidentialPayoutToken: string;
    payrollRegistry: string;
    streamAdapter: string;
    noxStreamPayroll: string;
  };
  abis: Record<keyof DeployedAddresses, Abi>;
  /** `protocolTag()` off the adapter — the underlying public stream protocol. */
  streamProtocol: string;
  usedMockPayoutAsset: boolean;
  /** The streaming-protocol core the adapter composes with. */
  sablierLockup?: Address;
  /** True only on chain 31337 when a local Sablier test double was deployed. */
  usedMockLockup: boolean;
}

const LOCAL_CHAIN_ID = 31337;
const SEPOLIA_CHAIN_ID = 11155111;

/**
 * Sablier Lockup v4.0 on Ethereum Sepolia. Verified live (24,481 bytes of
 * runtime code, 167 streams) — see docs/STREAM_PROTOCOL.md for the raw
 * `eth_getCode` evidence. Sablier has three live Sepolia releases, so "the"
 * Sablier address is ambiguous; this is the v4.0 one the adapter targets.
 */
const SABLIER_LOCKUP_BY_CHAIN: Record<number, Address> = {
  [SEPOLIA_CHAIN_ID]: "0xe61cb9153356419bdaD0A8767c059f92d221a3C4",
};

const DEFAULTS = {
  confidentialTokenName: "Confidential USDC",
  confidentialTokenSymbol: "cUSDC",
  confidentialTokenURI: "",
  mockMintAmount: 10_000_000_000_000n, // 10,000,000 USDC at 6 decimals
  /**
   * ~10 harvests' worth on Sepolia, where the fee is 483,091,068,406,659 wei
   * (0.000483 ETH). Anyone can top the tank up afterwards via `receive()`.
   */
  feeTankWei: 5_000_000_000_000_000n, // 0.005 ETH
} as const;

/**
 * Finds the single artifact under `contracts/` whose bare name matches
 * `predicate`. The stream adapter is named `<Protocol>StreamAdapter`, and which
 * protocol was chosen is a deploy-time decision, so we discover it rather than
 * hardcode it.
 */
async function findContractName(
  predicate: (bareName: string, fqn: string) => boolean,
  what: string,
): Promise<string> {
  const all = await artifacts.getAllFullyQualifiedNames();
  const matches: string[] = [];
  for (const fqn of all) {
    // Only our own sources; skip node_modules-sourced artifacts.
    if (!fqn.startsWith("contracts/")) continue;
    const bare = fqn.slice(fqn.lastIndexOf(":") + 1);
    if (predicate(bare, fqn)) matches.push(fqn);
  }
  if (matches.length === 0) {
    throw new Error(
      `No compiled contract found for ${what}. Run \`npx hardhat compile\` — ` +
        `and if the contract has not been written yet, this deploy cannot proceed.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous contract for ${what}: ${matches.join(", ")}. ` +
        `Narrow the selection in scripts/lib/deploy-system.ts.`,
    );
  }
  return matches[0];
}

export async function deployNoxStreamSystem<
  ChainTypeT extends ChainType | string,
>(
  connection: NetworkConnection<ChainTypeT>,
  options: DeployOptions = {},
): Promise<DeployedSystem> {
  const log = options.log ?? (() => {});
  const { viem } = connection as unknown as {
    viem: import("@nomicfoundation/hardhat-viem/types").HardhatViemHelpers;
  };

  const publicClient = await viem.getPublicClient();
  const [walletClient] = await viem.getWalletClients();
  const deployer = walletClient.account.address as Address;
  const chainId = await publicClient.getChainId();

  log(`network chainId=${chainId}`);
  log(`deployer   ${deployer}`);

  const txHashes: Record<string, Hex> = {};

  /** Deploys, waits for the receipt, and records the tx hash. */
  async function deploy(
    key: string,
    contractName: string,
    args: unknown[],
    value?: bigint,
  ): Promise<Address> {
    const { contract, deploymentTransaction } =
      await viem.sendDeploymentTransaction(
        contractName,
        args as never,
        value === undefined ? undefined : { value },
      );
    txHashes[key] = deploymentTransaction.hash;
    await publicClient.waitForTransactionReceipt({
      hash: deploymentTransaction.hash,
    });
    const address = contract.address as Address;
    log(
      `deployed ${contractName.padEnd(26)} ${address}  tx ${deploymentTransaction.hash}`,
    );
    return address;
  }

  async function abiOf(contractName: string): Promise<Abi> {
    return (await artifacts.readArtifact(contractName)).abi as Abi;
  }

  // ---------------------------------------------------------------------
  // 1. Payout asset — real ERC-20 when supplied, MockUSDC otherwise.
  // ---------------------------------------------------------------------
  let payoutAsset: Address;
  let payoutAssetName: string;
  let usedMockPayoutAsset: boolean;

  if (options.payoutAsset !== undefined) {
    const code = await publicClient.getCode({ address: options.payoutAsset });
    if (code === undefined || code === "0x") {
      throw new Error(
        `PAYOUT_ASSET_ADDRESS ${options.payoutAsset} has no bytecode on chain ${chainId}. ` +
          `Refusing to deploy against an address that is not a contract.`,
      );
    }
    payoutAsset = options.payoutAsset;
    payoutAssetName = "IERC20 (external)";
    usedMockPayoutAsset = false;
    log(`payout asset (external, verified to have code) ${payoutAsset}`);
  } else {
    const mockFqn = await findContractName(
      (bare) => bare === "MockUSDC",
      "the MockUSDC payout asset",
    );
    payoutAssetName = mockFqn;
    usedMockPayoutAsset = true;
    const mockAbi = await abiOf(mockFqn);
    payoutAsset = await deploy(
      "payoutAsset",
      mockFqn,
      resolveConstructorArgs(mockFqn, mockAbi, [
        { label: "name", aliases: ["name", "name_", "tokenName"], value: "Mock USD Coin" },
        { label: "symbol", aliases: ["symbol", "symbol_", "tokenSymbol"], value: "mUSDC" },
        { label: "decimals", aliases: ["decimals", "decimals_"], value: 6 },
        {
          label: "initialSupply",
          aliases: ["initialSupply", "supply", "amount", "initialAmount"],
          value: DEFAULTS.mockMintAmount,
        },
        {
          label: "deployer",
          aliases: [
            "owner",
            "initialOwner",
            "holder",
            "initialHolder",
            "recipient",
            "treasury",
            "to",
            "minter",
            "admin",
          ],
          value: deployer,
        },
      ]),
    );

    // Seed balances so the aggregate stream can actually be funded.
    const mintAmount = options.mockMintAmount ?? DEFAULTS.mockMintAmount;
    const mint = findFunction(mockAbi, ["mint"], 2);
    if (mint !== undefined) {
      const recipients = [deployer, ...(options.mockMintTo ?? [])];
      for (const to of recipients) {
        const hash = await walletClient.writeContract({
          address: payoutAsset,
          abi: mockAbi,
          functionName: "mint",
          args: [to, mintAmount],
        } as never);
        await publicClient.waitForTransactionReceipt({ hash });
        txHashes[`mintMockUSDC:${to}`] = hash;
        log(`minted ${mintAmount} mUSDC to ${to}  tx ${hash}`);
      }
    } else {
      log(
        `MockUSDC has no mint(address,uint256); assuming its constructor seeds supply.`,
      );
    }
  }

  // ---------------------------------------------------------------------
  // 2. ConfidentialPayoutToken — the ERC-7984 cUSDC employees are paid in.
  // ---------------------------------------------------------------------
  const cTokenName = await findContractName(
    (bare) => bare === "ConfidentialPayoutToken",
    "ConfidentialPayoutToken",
  );
  const cTokenAbi = await abiOf(cTokenName);
  const confidentialPayoutToken = await deploy(
    "confidentialPayoutToken",
    cTokenName,
    resolveConstructorArgs(cTokenName, cTokenAbi, [
      {
        label: "name",
        aliases: ["name", "name_", "tokenName"],
        value: options.confidentialTokenName ?? DEFAULTS.confidentialTokenName,
      },
      {
        label: "symbol",
        aliases: ["symbol", "symbol_", "tokenSymbol"],
        value:
          options.confidentialTokenSymbol ?? DEFAULTS.confidentialTokenSymbol,
      },
      {
        label: "contractURI",
        aliases: ["contractURI", "uri", "tokenURI", "metadataURI"],
        value: options.confidentialTokenURI ?? DEFAULTS.confidentialTokenURI,
      },
      {
        label: "payoutAsset",
        aliases: [
          "underlying",
          "underlyingToken",
          "underlyingAsset",
          "asset",
          "token",
          "erc20",
          "payoutAsset",
          "usdc",
        ],
        value: payoutAsset,
      },
    ]),
  );

  // ---------------------------------------------------------------------
  // 3. Stream adapter, 4. registry, 5. payroll — in that order, because the
  //    payroll constructor reads `adapter.asset()` and `registry.employer()`.
  //
  //    If the adapter's constructor wants the vault address, pre-compute it:
  //    the payroll is the second contract this account creates after the
  //    adapter, so its CREATE address is `keccak(rlp(deployer, nonce+2))[12:]`.
  //    Asserted against reality below rather than trusted.
  // ---------------------------------------------------------------------
  const adapterName = await findContractName(
    (bare, fqn) =>
      bare.endsWith("StreamAdapter") &&
      !bare.startsWith("I") &&
      fqn.startsWith("contracts/adapters/"),
    "the stream adapter (contracts/adapters/*StreamAdapter.sol)",
  );
  const adapterAbi = await abiOf(adapterName);

  const registryName = await findContractName(
    (bare) => bare === "NoxPayrollRegistry",
    "NoxPayrollRegistry",
  );
  const registryAbi = await abiOf(registryName);

  const payrollName = await findContractName(
    (bare) => bare === "NoxStreamPayroll",
    "NoxStreamPayroll",
  );
  const payrollAbi = await abiOf(payrollName);

  const adapterCtorParams = constructorInputs(adapterAbi).map((i) =>
    (i.name ?? "").toLowerCase(),
  );
  const adapterWantsVault = adapterCtorParams.some((n) =>
    /recipient|vault|payroll|noxstream|beneficiary/.test(n),
  );
  const adapterWantsLockup = adapterCtorParams.some((n) =>
    /lockup|sablier/.test(n),
  );

  // Resolve the underlying streaming protocol: explicit override, then the
  // verified per-chain constant, then — on the local chain only — a test double.
  let sablierLockup = options.sablierLockup ?? SABLIER_LOCKUP_BY_CHAIN[chainId];
  let usedMockLockup = false;
  if (adapterWantsLockup && sablierLockup === undefined) {
    if (chainId === LOCAL_CHAIN_ID && options.allowLocalMockLockup === true) {
      sablierLockup = await deploy("mockSablierLockup", "MockSablierLockup", []);
      usedMockLockup = true;
      log(
        `LOCAL TEST DOUBLE: MockSablierLockup at ${sablierLockup}. Never used off ` +
          `chain ${LOCAL_CHAIN_ID}; the Sepolia deploy composes with real Sablier.`,
      );
    } else {
      throw new Error(
        `${adapterName}'s constructor takes the Sablier Lockup core contract, but no ` +
          `address is known for chain ${chainId}. Set SABLIER_LOCKUP_ADDRESS in ` +
          `packages/contracts/.env — Sablier publishes its per-chain deployments at ` +
          `https://docs.sablier.com/guides/lockup/deployments. Refusing to substitute ` +
          `a mock on a live chain. Nothing further was broadcast.`,
      );
    }
  }
  if (adapterWantsLockup && chainId !== LOCAL_CHAIN_ID) {
    const code = await publicClient.getCode({ address: sablierLockup! });
    if (code === undefined || code === "0x") {
      throw new Error(
        `Sablier Lockup ${sablierLockup} has no bytecode on chain ${chainId}. ` +
          `The adapter would deploy but every harvest would revert. Nothing further ` +
          `was broadcast.`,
      );
    }
    log(`sablier lockup (verified to have code) ${sablierLockup}`);
  }

  // Read the nonce only now — after any test-double deployment above, so the
  // prediction is not thrown off by an extra transaction.
  const nonce = await publicClient.getTransactionCount({
    address: deployer,
    blockTag: "pending",
  });
  /** adapter = nonce, registry = nonce+1, payroll = nonce+2. */
  const predictedPayroll = getContractAddress({
    from: deployer,
    nonce: BigInt(nonce + 2),
  });
  if (adapterWantsVault) {
    log(
      `adapter constructor references the vault; predicted NoxStreamPayroll @ ${predictedPayroll} (deployer nonce ${nonce + 2})`,
    );
  }

  const feeTankWei = options.feeTankWei ?? DEFAULTS.feeTankWei;
  const streamAdapter = await deploy(
    "streamAdapter",
    adapterName,
    resolveConstructorArgs(adapterName, adapterAbi, [
      {
        label: "payoutAsset",
        aliases: [
          "asset",
          "token",
          "erc20",
          "payoutAsset",
          "streamedAsset",
          "underlying",
          "usdc",
        ],
        value: payoutAsset,
      },
      {
        label: "treasury",
        aliases: ["treasury", "employer", "owner", "funder", "sender", "admin"],
        value: deployer,
      },
      {
        label: "payroll",
        aliases: [
          "recipient",
          "vault",
          "payroll",
          "noxStream",
          "noxStreamPayroll",
          "beneficiary",
          "to",
        ],
        value: predictedPayroll,
      },
      {
        label: "sablierLockup",
        aliases: [
          "lockup",
          "sablier",
          "sablierLockup",
          "lockupLinear",
          "protocol",
        ],
        value: sablierLockup,
      },
    ]),
    // Seed the fee tank in the deploy tx. Sablier v3.0+ charges a native-token
    // fee on every withdrawal and `IStreamAdapter.harvest` is non-payable, so a
    // dry tank means every harvest reverts. Anyone can top it back up later.
    feeTankWei > 0n ? feeTankWei : undefined,
  );
  if (feeTankWei > 0n) {
    log(`seeded adapter fee tank with ${feeTankWei} wei`);
  }

  const payrollRegistry = await deploy(
    "payrollRegistry",
    registryName,
    resolveConstructorArgs(registryName, registryAbi, [
      {
        label: "employer",
        aliases: ["employer", "owner", "initialOwner", "admin", "treasury"],
        value: deployer,
      },
    ]),
  );

  const noxStreamPayroll = await deploy(
    "noxStreamPayroll",
    payrollName,
    resolveConstructorArgs(payrollName, payrollAbi, [
      {
        label: "registry",
        aliases: ["registry", "payrollRegistry", "roster", "noxPayrollRegistry"],
        value: payrollRegistry,
      },
      {
        label: "streamAdapter",
        aliases: ["streamAdapter", "adapter", "stream"],
        value: streamAdapter,
      },
      {
        label: "confidentialToken",
        aliases: [
          "confidentialToken",
          "confidentialPayoutToken",
          "payoutToken",
          "cToken",
          "token",
          "cusdc",
          "wrapper",
        ],
        value: confidentialPayoutToken,
      },
      {
        label: "payoutAsset",
        aliases: ["asset", "payoutAsset", "underlying", "erc20", "usdc"],
        value: payoutAsset,
      },
      {
        label: "employer",
        aliases: ["employer", "owner", "initialOwner", "treasury", "admin"],
        value: deployer,
      },
    ]),
  );

  if (adapterWantsVault && noxStreamPayroll.toLowerCase() !== predictedPayroll.toLowerCase()) {
    throw new Error(
      `CREATE address prediction failed: adapter was constructed pointing at ` +
        `${predictedPayroll} but NoxStreamPayroll landed at ${noxStreamPayroll}. ` +
        `The deployer account sent an unexpected transaction mid-deploy. Re-run.`,
    );
  }

  // ---------------------------------------------------------------------
  // 6. Wiring. Only calls setters that actually exist, and logs every one.
  // ---------------------------------------------------------------------
  async function callIfPresent(
    label: string,
    address: Address,
    abi: Abi,
    names: string[],
    args: unknown[],
  ): Promise<boolean> {
    const fn = findFunction(abi, names, args.length);
    if (fn === undefined) return false;
    const hash = await walletClient.writeContract({
      address,
      abi,
      functionName: fn.name,
      args,
    } as never);
    await publicClient.waitForTransactionReceipt({ hash });
    txHashes[label] = hash;
    log(`wired ${label}: ${fn.name}(${args.join(", ")})  tx ${hash}`);
    return true;
  }

  await callIfPresent(
    "registry.setPayroll",
    payrollRegistry,
    registryAbi,
    ["setPayroll", "setPayrollContract", "setSettlement", "authorizePayroll"],
    [noxStreamPayroll],
  );
  await callIfPresent(
    "adapter.setRecipient",
    streamAdapter,
    adapterAbi,
    ["setRecipient", "setVault", "setPayroll", "setBeneficiary"],
    [noxStreamPayroll],
  );
  await callIfPresent(
    "confidentialToken.setPayroll",
    confidentialPayoutToken,
    cTokenAbi,
    ["setPayroll", "setMinter", "setWrapper", "setOperatorContract"],
    [noxStreamPayroll],
  );

  if (options.startPayroll !== false) {
    const started = await callIfPresent(
      "payroll.start",
      noxStreamPayroll,
      payrollAbi,
      ["start", "startPayroll", "begin"],
      [],
    );
    if (!started) {
      log(`payroll has no start()/startPayroll(); assuming it starts on deploy.`);
    }
  }

  // Adapter self-describes which public streaming protocol it wraps.
  let streamProtocol = "unknown";
  try {
    streamProtocol = (await publicClient.readContract({
      address: streamAdapter,
      abi: adapterAbi,
      functionName: "protocolTag",
    })) as string;
  } catch {
    log(`adapter.protocolTag() unavailable; recording "unknown".`);
  }
  log(`stream protocol: ${streamProtocol}`);

  return {
    deployer,
    chainId,
    addresses: {
      payoutAsset,
      confidentialPayoutToken,
      payrollRegistry,
      streamAdapter,
      noxStreamPayroll,
    },
    txHashes,
    contractNames: {
      payoutAsset: payoutAssetName,
      confidentialPayoutToken: cTokenName,
      payrollRegistry: registryName,
      streamAdapter: adapterName,
      noxStreamPayroll: payrollName,
    },
    abis: {
      payoutAsset: usedMockPayoutAsset
        ? ((await artifacts.readArtifact(payoutAssetName)).abi as Abi)
        : ([] as unknown as Abi),
      confidentialPayoutToken: cTokenAbi,
      payrollRegistry: registryAbi,
      streamAdapter: adapterAbi,
      noxStreamPayroll: payrollAbi,
    },
    streamProtocol,
    usedMockPayoutAsset,
    sablierLockup,
    usedMockLockup,
  };
}
