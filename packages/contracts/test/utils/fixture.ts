/**
 * Local test fixture: one Nox Docker stack per process, many fresh deployments.
 *
 * The Hardhat plugin binds a JSON-RPC relay to port 8545 when it boots the
 * local stack, and refuses to start a second one. `node:test` runs each test
 * *file* in its own worker process (`concurrency: true` in
 * @nomicfoundation/hardhat-node-test-runner), so **only one test file in this
 * project may touch the Nox stack**. All chain-touching unit tests therefore
 * live in `test/unit/payroll.test.ts`; anything else must be pure offline
 * logic. This is documented here because the failure mode otherwise is a
 * baffling "Port 8545 is already in use" from a file that never mentions ports.
 */
import { network } from "hardhat";
import { nox } from "@iexec-nox/nox-hardhat-plugin";
import type {
  Abi,
  Address,
  Hex,
  WalletClient as ViemWalletClient,
} from "viem";
import {
  deployNoxStreamSystem,
  type DeployedSystem,
} from "../../scripts/lib/deploy-system.js";
import { localAccountWallet, type NoxClient } from "./nox.js";

type Connection = Awaited<ReturnType<typeof network.connect>>;
type Viem = Connection extends { viem: infer V } ? V : never;
type PublicClient = Awaited<ReturnType<Viem["getPublicClient"]>>;
type WalletClient = Awaited<ReturnType<Viem["getWalletClients"]>>[number];

export interface LocalStack {
  connection: Connection;
  noxClient: NoxClient;
  publicClient: PublicClient;
  wallets: WalletClient[];
}

let stackPromise: Promise<LocalStack> | undefined;

/** Boots (once) and returns the local Nox stack. */
export function localStack(): Promise<LocalStack> {
  stackPromise ??= (async () => {
    const connection = await network.connect();
    const noxClient = await nox.connect(connection);
    const { viem } = connection;
    return {
      connection,
      noxClient,
      publicClient: await viem.getPublicClient(),
      wallets: await viem.getWalletClients(),
    };
  })();
  return stackPromise;
}

export interface Scenario extends LocalStack {
  system: DeployedSystem;
  employer: WalletClient;
  /** Roster candidates. Distinct from `employer` and `outsider`. */
  alice: WalletClient;
  bob: WalletClient;
  /** Holds no ACL grant on anything — the adversary in the ACL tests. */
  outsider: WalletClient;
  /**
   * Local-account twins of the wallets above, for the Nox handle SDK only.
   * See `handleClientFor` in test/utils/nox.ts for why the node-backed clients
   * cannot be used to sign a decryption request.
   */
  signers: {
    employer: ViemWalletClient;
    alice: ViemWalletClient;
    bob: ViemWalletClient;
    outsider: ViemWalletClient;
  };
  addresses: DeployedSystem["addresses"];
  abis: DeployedSystem["abis"];
}

/**
 * Deploys a complete, freshly wired NoxStream on the shared local stack.
 * Uses the same `deployNoxStreamSystem` the Sepolia script uses, so the tests
 * exercise the real deployment path rather than a test-only shortcut.
 */
export async function deployScenario(
  options: { log?: boolean } = {},
): Promise<Scenario> {
  const stack = await localStack();
  const [employer, alice, bob, outsider] = stack.wallets;

  const system = await deployNoxStreamSystem(stack.connection, {
    mockMintTo: [],
    // Chain 31337 has no Sablier. The test double stands up a minimal Lockup so
    // the tests exercise the REAL SablierStreamAdapter bytecode — fee tank,
    // destination guard and all — rather than a second, simpler adapter that
    // would never ship. `deployNoxStreamSystem` refuses this off chain 31337.
    allowLocalMockLockup: true,
    log: options.log === true ? (m) => console.log(`  [deploy] ${m}`) : undefined,
  });

  return {
    ...stack,
    system,
    employer,
    alice,
    bob,
    outsider,
    signers: {
      employer: localAccountWallet(stack.connection, 0),
      alice: localAccountWallet(stack.connection, 1),
      bob: localAccountWallet(stack.connection, 2),
      outsider: localAccountWallet(stack.connection, 3),
    },
    addresses: system.addresses,
    abis: system.abis,
  };
}

/** Sends a write from `wallet` and waits for it to be mined. Returns the hash. */
export async function send(
  scenario: Pick<Scenario, "publicClient">,
  wallet: WalletClient,
  args: {
    address: Address;
    abi: Abi;
    functionName: string;
    args?: readonly unknown[];
  },
): Promise<Hex> {
  const hash = await wallet.writeContract({
    address: args.address,
    abi: args.abi,
    functionName: args.functionName,
    args: args.args ?? [],
  } as never);
  const receipt = await scenario.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`${args.functionName} reverted (tx ${hash})`);
  }
  return hash;
}

export async function read<T>(
  scenario: Pick<Scenario, "publicClient">,
  args: {
    address: Address;
    abi: Abi;
    functionName: string;
    args?: readonly unknown[];
  },
): Promise<T> {
  return (await scenario.publicClient.readContract({
    address: args.address,
    abi: args.abi,
    functionName: args.functionName,
    args: args.args ?? [],
  })) as T;
}

/**
 * Encrypts `rate` for the registry and writes it as `employee`'s allocation.
 * The encryption is bound to the registry address, so the resulting handle
 * cannot be replayed against any other contract.
 */
export async function setAllocation(
  scenario: Scenario,
  employee: Address,
  ratePerSecond: bigint,
): Promise<Hex> {
  const enc = await scenario.noxClient.encryptInput(
    ratePerSecond,
    "uint256",
    scenario.addresses.payrollRegistry,
  );
  return send(scenario, scenario.employer, {
    address: scenario.addresses.payrollRegistry,
    abi: scenario.abis.payrollRegistry,
    functionName: "setAllocation",
    args: [employee, enc.handle, enc.handleProof],
  });
}

/**
 * Opens the single public aggregate stream: approve, then `fundStream`.
 * Entirely public and unencrypted, by design — only the breakdown is secret.
 */
export async function fundAggregateStream(
  scenario: Scenario,
  totalAmount: bigint,
  durationSeconds: number,
): Promise<{ approveTx: Hex; fundTx: Hex }> {
  const approveTx = await send(scenario, scenario.employer, {
    address: scenario.addresses.payoutAsset,
    abi: scenario.abis.payoutAsset,
    functionName: "approve",
    args: [scenario.addresses.streamAdapter, totalAmount],
  });
  const fundTx = await send(scenario, scenario.employer, {
    address: scenario.addresses.streamAdapter,
    abi: scenario.abis.streamAdapter,
    functionName: "fundStream",
    args: [totalAmount, durationSeconds],
  });
  return { approveTx, fundTx };
}
