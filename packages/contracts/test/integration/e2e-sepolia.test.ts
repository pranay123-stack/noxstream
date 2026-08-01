/**
 * ============================================================================
 * NoxStream end-to-end on LIVE Ethereum Sepolia + LIVE Nox.
 * ============================================================================
 *
 *   npx hardhat test test/integration/e2e-sepolia.test.ts --network sepolia
 *
 * Nothing here is simulated. It runs the whole product against the deployed
 * contracts recorded in `packages/shared/src/deployments/sepolia.json`, the
 * real Sablier Lockup v4.0, and the real Nox handle gateway:
 *
 *   encrypt an allocation -> register it -> fund the public aggregate stream
 *   -> harvest -> the employee claims -> the employee decrypts their own balance
 *
 * ## The point of this file is the leak assertions, not the happy path
 *
 * A test that only proves "the money arrived" proves nothing about
 * confidentiality. So this test also tries hard to *falsify* NoxStream's
 * central claim, and fails if it can:
 *
 *   1. Every on-chain salary read must be a 32-byte handle, never the value.
 *   2. Every log topic, every log data blob and every transaction's calldata,
 *      across every transaction in the flow, is searched for the plaintext in
 *      several encodings and widths — word-aligned (32/16/8 byte), minimal
 *      big-endian, minimal little-endian and decimal ASCII.
 *   3. `eth_getStorageAt` is walked over each contract's sequential slots and
 *      over the `keccak256(abi.encode(employee, slot))` locations Solidity uses
 *      for `mapping(address => ...)`, and searched for the same patterns.
 *   4. A third-party account — freshly generated, holding no ACL grant — must
 *      FAIL to decrypt the employee's handles.
 *   5. The employee themselves must SUCCEED, and get the exact expected number.
 *
 * The scanner is self-tested before it is trusted (`assertNeedlesAreDetectable`),
 * because a leak detector that silently cannot detect anything would turn every
 * assertion below into a lie. `test/unit/leak-scanner.test.ts` tests it further,
 * offline, on every CI run.
 *
 * ## What this test does NOT claim
 *
 * Nox gives confidentiality, not anonymity. Roster membership, the fact that a
 * claim happened, and the AGGREGATE harvested amount are public on purpose —
 * that is what keeps the stream auditable and composable. `Harvested` is the one
 * event carrying a plaintext amount, and the test asserts it is genuinely an
 * aggregate rather than pretending it does not exist.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { before, describe, it } from "node:test";
import { artifacts, network } from "hardhat";
import { nox } from "@iexec-nox/nox-hardhat-plugin";
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  parseEventLogs,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { DEPLOYMENTS_DIR, readSepoliaEnv } from "../../scripts/lib/env.js";
import {
  assertIsHandle,
  assertNeedlesAreDetectable,
  assertNoLeak,
  describeNeedles,
  haystacksFromTx,
  plaintextNeedles,
  scanStorage,
  type Haystack,
  type Needle,
} from "../utils/leak-scan.js";
import { assertCannotDecrypt, handleClientFor } from "../utils/nox.js";
import { waitForHandleResolved } from "../utils/handle-gateway.js";

/**
 * Real Sepolia is slow in three independent ways: ~12s blocks, a shared Nox
 * gateway whose handle resolution routinely takes tens of seconds, and a live
 * Sablier stream that must actually unlock. The plugin's own internal poller
 * gives up after 6 seconds (RESOLVE_MAX_RETRIES=60 x RESOLVE_DELAY_MS=100), so
 * every decrypt here goes through `waitForHandleResolved` first.
 */
const TIMEOUT = 30 * 60 * 1000;
const HANDLE_TIMEOUT = 5 * 60 * 1000;

const USDC = 1_000_000n; // 6 decimals
const SECONDS_PER_MONTH = 30n * 24n * 60n * 60n;

/**
 * Deliberately un-round so it cannot be confused with a fee, a timestamp or a
 * round aggregate if it ever showed up in a blob.
 */
const EMPLOYEE_MONTHLY = 7_654_321_000n; // 7,654.321 USDC / month
const EMPLOYEE_RATE = EMPLOYEE_MONTHLY / SECONDS_PER_MONTH; // 2,952 units/second

/** Public aggregate budget and horizon. Small, so a testnet run is cheap. */
const STREAM_BUDGET = 500n * USDC;
const STREAM_DURATION = 60 * 60; // 1 hour

/** Wall-clock accrual window before harvesting. */
const ACCRUAL_WAIT_MS = 120_000;

interface DeploymentRecord {
  chainId: number;
  deployer: Address;
  contracts: {
    payrollRegistry: Address;
    noxStreamPayroll: Address;
    confidentialPayoutToken: Address;
    streamAdapter: Address;
    payoutAsset: Address;
  };
  nox: { noxComputeAddress: Address; handleGatewayUrl: string };
  streamProtocol: string;
}

const ZERO_HANDLE = `0x${"00".repeat(32)}` as Hex;

function skipMessage(reason: string): string {
  return [
    ``,
    `  ${"=".repeat(70)}`,
    `  Sepolia e2e cannot run: ${reason}`,
    `  ${"=".repeat(70)}`,
    `  This test drives LIVE Sepolia. It needs, in packages/contracts/.env:`,
    `    SEPOLIA_RPC_URL       an RPC endpoint`,
    `    DEPLOYER_PRIVATE_KEY  the employer/treasury key, funded with Sepolia ETH`,
    `    EMPLOYEE_PRIVATE_KEY  a second funded key that acts as the employee`,
    `  and a deployment record at`,
    `    packages/shared/src/deployments/sepolia.json`,
    `  produced by:  npm run deploy`,
    ``,
    `  Faucets: https://www.alchemy.com/faucets/ethereum-sepolia`,
    ``,
    `  Nothing was broadcast and no result is being reported as passing.`,
    ``,
  ].join("\n");
}

describe("NoxStream end-to-end on live Sepolia", { timeout: TIMEOUT }, () => {
  let record: DeploymentRecord;
  let noxClient: Awaited<ReturnType<typeof nox.connect>>;
  let publicClient: ReturnType<typeof createPublicClient>;
  let employer: ReturnType<typeof createWalletClient>;
  let employee: ReturnType<typeof createWalletClient>;
  let employeeAddress: Address;

  let abis: {
    registry: Abi;
    payroll: Abi;
    cToken: Abi;
    adapter: Abi;
    erc20: Abi;
  };

  /** Every transaction this test sends, for the leak sweep at the end. */
  const flowTxs: Array<{ label: string; hash: Hex }> = [];

  before(async () => {
    const env = readSepoliaEnv({ requireEmployee: true });
    if (env.missing.length > 0) {
      throw new Error(skipMessage(`missing ${env.missing.join(", ")}`));
    }

    const recordPath = path.join(DEPLOYMENTS_DIR, "sepolia.json");
    if (!existsSync(recordPath)) {
      throw new Error(skipMessage(`no deployment record at ${recordPath}`));
    }
    record = JSON.parse(readFileSync(recordPath, "utf8")) as DeploymentRecord;
    assert.equal(
      record.chainId,
      11155111,
      `deployment record is for chain ${record.chainId}, not Sepolia`,
    );

    const connection = await network.connect({ network: "sepolia" });
    noxClient = await nox.connect(connection);
    assert.equal(
      noxClient.noxComputeAddress.toLowerCase(),
      record.nox.noxComputeAddress.toLowerCase(),
      `the configured NoxCompute differs from the one the contracts were ` +
        `deployed against — handles minted now would not match`,
    );

    const transport = http(env.rpcUrl);
    publicClient = createPublicClient({ chain: sepolia, transport });
    employer = createWalletClient({
      account: privateKeyToAccount(env.deployerKey!),
      chain: sepolia,
      transport,
    });
    employee = createWalletClient({
      account: privateKeyToAccount(env.employeeKey!),
      chain: sepolia,
      transport,
    });
    employeeAddress = employee.account!.address;

    for (const [who, client] of [
      ["employer", employer],
      ["employee", employee],
    ] as const) {
      const balance = await publicClient.getBalance({
        address: client.account!.address,
      });
      if (balance === 0n) {
        throw new Error(
          skipMessage(
            `${who} ${client.account!.address} has 0 ETH on Sepolia ` +
              `(needs gas to send transactions)`,
          ),
        );
      }
      console.log(
        `  ${who.padEnd(9)} ${client.account!.address}  ${formatEther(balance)} ETH`,
      );
    }

    abis = {
      registry: (await artifacts.readArtifact("NoxPayrollRegistry")).abi as Abi,
      payroll: (await artifacts.readArtifact("NoxStreamPayroll")).abi as Abi,
      cToken: (await artifacts.readArtifact("ConfidentialPayoutToken"))
        .abi as Abi,
      adapter: (await artifacts.readArtifact("SablierStreamAdapter")).abi as Abi,
      erc20: (await artifacts.readArtifact("MockUSDC")).abi as Abi,
    };

    console.log(`  registry   ${record.contracts.payrollRegistry}`);
    console.log(`  payroll    ${record.contracts.noxStreamPayroll}`);
    console.log(`  cUSDC      ${record.contracts.confidentialPayoutToken}`);
    console.log(`  adapter    ${record.contracts.streamAdapter}`);
    console.log(`  payout     ${record.contracts.payoutAsset}`);
    console.log(`  protocol   ${record.streamProtocol}`);
  });

  // -------------------------------------------------------------------
  // helpers
  // -------------------------------------------------------------------
  async function write(
    label: string,
    wallet: ReturnType<typeof createWalletClient>,
    args: {
      address: Address;
      abi: Abi;
      functionName: string;
      args?: readonly unknown[];
      value?: bigint;
    },
  ): Promise<Hex> {
    const hash = await wallet.writeContract({
      address: args.address,
      abi: args.abi,
      functionName: args.functionName,
      args: args.args ?? [],
      value: args.value,
      chain: sepolia,
      account: wallet.account!,
    } as never);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, "success", `${label} reverted (tx ${hash})`);
    flowTxs.push({ label, hash });
    console.log(`  tx ${label.padEnd(16)} ${hash}`);
    return hash;
  }

  async function read<T>(args: {
    address: Address;
    abi: Abi;
    functionName: string;
    args?: readonly unknown[];
  }): Promise<T> {
    return (await publicClient.readContract({
      address: args.address,
      abi: args.abi,
      functionName: args.functionName,
      args: args.args ?? [],
    })) as T;
  }

  /** Uninitialised handles are a legitimate "zero", not a decryption failure. */
  async function decryptAsEmployee(handle: Hex): Promise<bigint> {
    if (handle === ZERO_HANDLE) return 0n;
    const client = await handleClientFor(employee, noxClient);
    await waitForHandleResolved(noxClient.handleGatewayUrl, handle, {
      timeoutMs: HANDLE_TIMEOUT,
    });
    const { value } = await client.decrypt(handle as never);
    return value as bigint;
  }

  async function blockTimestampOf(hash: Hex): Promise<bigint> {
    const receipt = await publicClient.getTransactionReceipt({ hash });
    const block = await publicClient.getBlock({
      blockNumber: receipt.blockNumber,
    });
    return block.timestamp;
  }

  // -------------------------------------------------------------------
  // the flow
  // -------------------------------------------------------------------
  let allocationTs = 0n;
  let accruedBefore = 0n;
  let claimedBefore = 0n;
  let balanceBefore = 0n;
  let claimTs = 0n;
  let paid = 0n;
  let harvestedPublic = 0n;

  it("1. registers an encrypted allocation on the live registry", async () => {
    // Encrypted client-side and BOUND to the registry address, so the handle
    // cannot be replayed against any other contract.
    const enc = await noxClient.encryptInput(
      EMPLOYEE_RATE,
      "uint256",
      record.contracts.payrollRegistry,
    );
    console.log(`  encrypted rate handle ${enc.handle}`);

    const hash = await write("setAllocation", employer, {
      address: record.contracts.payrollRegistry,
      abi: abis.registry,
      functionName: "setAllocation",
      args: [employeeAddress, enc.handle, enc.handleProof],
    });
    allocationTs = await read<bigint>({
      address: record.contracts.noxStreamPayroll,
      abi: abis.payroll,
      functionName: "lastAccrualAt",
      args: [employeeAddress],
    });
    assert.notEqual(allocationTs, 0n, "accrual clock was not anchored");

    assert.equal(
      await read<boolean>({
        address: record.contracts.payrollRegistry,
        abi: abis.registry,
        functionName: "isRegistered",
        args: [employeeAddress],
      }),
      true,
    );

    // What the chain now holds for this employee is a handle, not a number.
    const rateHandle = await read<Hex>({
      address: record.contracts.payrollRegistry,
      abi: abis.registry,
      functionName: "ratePerSecondOf",
      args: [employeeAddress],
    });
    assertIsHandle(rateHandle, "registry.ratePerSecondOf(employee)", {
      notEqualTo: [EMPLOYEE_RATE, EMPLOYEE_MONTHLY],
    });

    // Snapshot the confidential state so the assertions below survive a re-run
    // against a registry that already had history for this address.
    accruedBefore = await decryptAsEmployee(
      await read<Hex>({
        address: record.contracts.noxStreamPayroll,
        abi: abis.payroll,
        functionName: "confidentialAccruedOf",
        args: [employeeAddress],
      }),
    );
    claimedBefore = await decryptAsEmployee(
      await read<Hex>({
        address: record.contracts.noxStreamPayroll,
        abi: abis.payroll,
        functionName: "confidentialClaimedOf",
        args: [employeeAddress],
      }),
    );
    balanceBefore = await decryptAsEmployee(
      await read<Hex>({
        address: record.contracts.confidentialPayoutToken,
        abi: abis.cToken,
        functionName: "confidentialBalanceOf",
        args: [employeeAddress],
      }),
    );
    console.log(
      `  pre-state  accrued=${accruedBefore} claimed=${claimedBefore} cUSDC=${balanceBefore}`,
    );
    void hash;
  });

  it("2. funds ONE public aggregate Sablier stream", async () => {
    const existing = await read<bigint>({
      address: record.contracts.streamAdapter,
      abi: abis.adapter,
      functionName: "streamId",
    });

    if (existing === 0n) {
      // MockUSDC is a public faucet on testnet; with a real USDC payout asset
      // the treasury must already hold the budget.
      const balance = await read<bigint>({
        address: record.contracts.payoutAsset,
        abi: abis.erc20,
        functionName: "balanceOf",
        args: [employer.account!.address],
      });
      if (balance < STREAM_BUDGET) {
        await write("mintPayoutAsset", employer, {
          address: record.contracts.payoutAsset,
          abi: abis.erc20,
          functionName: "mint",
          args: [employer.account!.address, STREAM_BUDGET * 10n],
        });
      }

      await write("approveAdapter", employer, {
        address: record.contracts.payoutAsset,
        abi: abis.erc20,
        functionName: "approve",
        args: [record.contracts.streamAdapter, STREAM_BUDGET],
      });
      await write("fundStream", employer, {
        address: record.contracts.streamAdapter,
        abi: abis.adapter,
        functionName: "fundStream",
        args: [STREAM_BUDGET, STREAM_DURATION],
      });
    } else {
      console.log(`  stream ${existing} already open — reusing it`);
    }

    const streamId = await read<bigint>({
      address: record.contracts.streamAdapter,
      abi: abis.adapter,
      functionName: "streamId",
    });
    assert.notEqual(streamId, 0n, "no Sablier stream is open");
    console.log(`  sablier stream id ${streamId}`);

    // Sablier v3.0+ charges a native-token fee on every withdrawal, and
    // `IStreamAdapter.harvest` is non-payable, so the adapter pays from its own
    // balance. Top it up if the deploy-time seed has been spent.
    const fee = await read<bigint>({
      address: record.contracts.streamAdapter,
      abi: abis.adapter,
      functionName: "minHarvestFeeWei",
    });
    const tank = await read<bigint>({
      address: record.contracts.streamAdapter,
      abi: abis.adapter,
      functionName: "feeTankBalance",
    });
    console.log(`  fee tank ${tank} wei, harvest needs ${fee} wei`);
    if (tank < fee) {
      const topUp = fee * 4n;
      const hash = await employer.sendTransaction({
        to: record.contracts.streamAdapter,
        value: topUp,
        chain: sepolia,
        account: employer.account!,
      } as never);
      await publicClient.waitForTransactionReceipt({ hash });
      flowTxs.push({ label: "topUpFeeTank", hash });
      console.log(`  topped fee tank up with ${topUp} wei  ${hash}`);
    }
  });

  it("3. harvests the unlocked aggregate into the confidential vault", async () => {
    console.log(`  waiting ${ACCRUAL_WAIT_MS / 1000}s for accrual + unlock...`);
    await sleep(ACCRUAL_WAIT_MS);

    const withdrawable = await read<bigint>({
      address: record.contracts.streamAdapter,
      abi: abis.adapter,
      functionName: "withdrawableAmount",
    });
    assert.ok(
      withdrawable > 0n,
      "the Sablier stream has unlocked nothing yet — extend ACCRUAL_WAIT_MS",
    );
    console.log(`  sablier unlocked ${withdrawable} base units`);

    const hash = await write("harvest", employer, {
      address: record.contracts.noxStreamPayroll,
      abi: abis.payroll,
      functionName: "harvest",
    });

    // `Harvested(uint256 publicAmount, uint64 epoch)` is the ONE event that
    // carries a plaintext amount, and that is the design: the aggregate is
    // meant to be auditable. Decode it from the receipt rather than inferring
    // it from a balance, so the "this number is the aggregate, not a salary"
    // assertion in test 5 is about the exact value that was published.
    const receipt = await publicClient.getTransactionReceipt({ hash });
    const harvestedEvents = parseEventLogs({
      abi: abis.payroll,
      eventName: "Harvested",
      logs: receipt.logs,
    }) as unknown as Array<{ args: { publicAmount: bigint; epoch: bigint } }>;
    assert.equal(
      harvestedEvents.length,
      1,
      "expected exactly one Harvested event",
    );
    harvestedPublic = harvestedEvents[0].args.publicAmount;

    const vaultHolds = await read<bigint>({
      address: record.contracts.payoutAsset,
      abi: abis.erc20,
      functionName: "balanceOf",
      args: [record.contracts.confidentialPayoutToken],
    });
    console.log(
      `  Harvested(publicAmount=${harvestedPublic}) — public by design; ` +
        `vault now backs ${vaultHolds} base units of cUSDC ` +
        `(${receipt.logs.length} logs in the harvest tx)`,
    );
    assert.ok(harvestedPublic > 0n, "nothing was wrapped into cUSDC");
  });

  it("4. the employee claims — confidentially", async () => {
    const hash = await write("claim", employee, {
      address: record.contracts.noxStreamPayroll,
      abi: abis.payroll,
      functionName: "claim",
    });
    claimTs = await blockTimestampOf(hash);

    const startedAt = await read<bigint>({
      address: record.contracts.noxStreamPayroll,
      abi: abis.payroll,
      functionName: "startedAt",
    });
    assert.notEqual(startedAt, 0n, "payroll was never started");

    const from = allocationTs > startedAt ? allocationTs : startedAt;
    const expectedNewAccrual = EMPLOYEE_RATE * (claimTs - from);
    console.log(
      `  accrual window ${claimTs - from}s x ${EMPLOYEE_RATE}/s = ${expectedNewAccrual}`,
    );

    const accruedAfter = await decryptAsEmployee(
      await read<Hex>({
        address: record.contracts.noxStreamPayroll,
        abi: abis.payroll,
        functionName: "confidentialAccruedOf",
        args: [employeeAddress],
      }),
    );
    const claimedAfter = await decryptAsEmployee(
      await read<Hex>({
        address: record.contracts.noxStreamPayroll,
        abi: abis.payroll,
        functionName: "confidentialClaimedOf",
        args: [employeeAddress],
      }),
    );
    const balanceAfter = await decryptAsEmployee(
      await read<Hex>({
        address: record.contracts.confidentialPayoutToken,
        abi: abis.cToken,
        functionName: "confidentialBalanceOf",
        args: [employeeAddress],
      }),
    );
    paid = balanceAfter - balanceBefore;

    // Accrual is exactly rate x elapsed — computed entirely inside the TEE.
    assert.equal(
      accruedAfter,
      accruedBefore + expectedNewAccrual,
      `accrual mismatch: expected ${accruedBefore + expectedNewAccrual}, got ${accruedAfter}`,
    );
    // Whatever was booked as claimed is exactly what moved.
    assert.equal(
      claimedAfter - claimedBefore,
      paid,
      `bookkeeping mismatch: claimed rose by ${claimedAfter - claimedBefore} ` +
        `but the balance rose by ${paid}`,
    );
    assert.ok(paid > 0n, "the claim moved nothing");
    // The vault was funded well beyond one salary, so this is the un-clamped
    // path and the employee should have been paid in full.
    assert.equal(
      claimedAfter,
      accruedAfter,
      `expected a full settlement (vault holds ${harvestedPublic}), but ` +
        `claimed ${claimedAfter} of ${accruedAfter} accrued`,
    );
    console.log(`  employee was paid ${paid} base units, confidentially`);
  });

  // -------------------------------------------------------------------
  // THE LEAK ASSERTIONS
  // -------------------------------------------------------------------
  it("5. PROOF: no plaintext salary in any event, topic or calldata", async () => {
    const secrets = [
      { label: "rate", value: EMPLOYEE_RATE },
      { label: "monthly", value: EMPLOYEE_MONTHLY },
      { label: "paid", value: paid },
    ];
    const needles: Needle[] = secrets.flatMap((s) =>
      plaintextNeedles(s.label, s.value),
    );
    console.log(`  scanning for:\n${describeNeedles(secrets)}`);

    // Prove the scanner can actually find these patterns before trusting a
    // negative result from it.
    assertNeedlesAreDetectable(needles);

    assert.ok(flowTxs.length >= 3, "the flow produced suspiciously few txs");

    let scanned = 0;
    for (const { label, hash } of flowTxs) {
      const haystacks = await haystacksFromTx(publicClient, hash, label);
      scanned += haystacks.length;

      if (label === "harvest") {
        // The aggregate IS public, deliberately. Assert that what is public is
        // genuinely the aggregate: it must not equal the individual payment,
        // and no per-employee secret may appear.
        assert.notEqual(
          harvestedPublic,
          paid,
          "the public aggregate equals the individual payment — with a single " +
            "claimant that would disclose it",
        );
        assertNoLeak(
          haystacks,
          [
            ...plaintextNeedles("rate", EMPLOYEE_RATE),
            ...plaintextNeedles("monthly", EMPLOYEE_MONTHLY),
          ],
          "harvest tx must carry only the aggregate, never a per-employee rate",
        );
        continue;
      }
      assertNoLeak(haystacks, needles, `${label} transaction`);
    }
    console.log(
      `  ${scanned} hex fields across ${flowTxs.length} transactions: clean`,
    );
  });

  it("6. PROOF: no plaintext salary in contract storage", async () => {
    const needles: Needle[] = [
      ...plaintextNeedles("rate", EMPLOYEE_RATE),
      ...plaintextNeedles("monthly", EMPLOYEE_MONTHLY),
      ...plaintextNeedles("paid", paid),
    ];
    assertNeedlesAreDetectable(needles);

    const targets: Array<[string, Address]> = [
      ["NoxPayrollRegistry", record.contracts.payrollRegistry],
      ["NoxStreamPayroll", record.contracts.noxStreamPayroll],
      ["ConfidentialPayoutToken", record.contracts.confidentialPayoutToken],
    ];

    let slots = 0;
    for (const [label, address] of targets) {
      const haystacks: Haystack[] = await scanStorage(
        publicClient,
        address,
        label,
        {
          slotCount: 16,
          mappingKeys: [employeeAddress],
          mappingSlotCount: 16,
          structWords: 2,
        },
      );
      slots += haystacks.length;
      assertNoLeak(haystacks, needles, `${label} storage`);
    }
    console.log(`  ${slots} storage words across 3 contracts: clean`);
  });

  it("7. PROOF: a third party cannot decrypt the employee's salary", async () => {
    // A brand-new key that has never touched this chain, so it can hold no ACL
    // grant by construction. Decryption is gasless (EIP-712 signed), so it does
    // not need funding — which is exactly why the ACL, not the gas balance, is
    // what stops it.
    const outsiderKey = generatePrivateKey();
    const outsider = createWalletClient({
      account: privateKeyToAccount(outsiderKey),
      chain: sepolia,
      transport: http(readSepoliaEnv().rpcUrl),
    });
    const outsiderNox = await handleClientFor(outsider, noxClient);
    console.log(`  outsider ${outsider.account.address} (unfunded, no grants)`);

    const handles: Array<[string, Hex]> = [
      [
        "ratePerSecondOf",
        await read<Hex>({
          address: record.contracts.payrollRegistry,
          abi: abis.registry,
          functionName: "ratePerSecondOf",
          args: [employeeAddress],
        }),
      ],
      [
        "confidentialAccruedOf",
        await read<Hex>({
          address: record.contracts.noxStreamPayroll,
          abi: abis.payroll,
          functionName: "confidentialAccruedOf",
          args: [employeeAddress],
        }),
      ],
      [
        "confidentialBalanceOf",
        await read<Hex>({
          address: record.contracts.confidentialPayoutToken,
          abi: abis.cToken,
          functionName: "confidentialBalanceOf",
          args: [employeeAddress],
        }),
      ],
    ];

    for (const [what, handle] of handles) {
      assertIsHandle(handle, what, {
        notEqualTo: [EMPLOYEE_RATE, EMPLOYEE_MONTHLY, paid],
      });
      const why = await assertCannotDecrypt(
        outsiderNox,
        handle,
        `third party on ${what}`,
      );
      console.log(`  ${what.padEnd(24)} refused: ${why.slice(0, 100)}`);
    }
  });

  it("8. PROOF: the employee CAN decrypt their own, and it is the right number", async () => {
    // The converse of test 7. Without this, "nobody could decrypt anything"
    // would satisfy every other assertion in this file while making the product
    // useless.
    const rateHandle = await read<Hex>({
      address: record.contracts.payrollRegistry,
      abi: abis.registry,
      functionName: "ratePerSecondOf",
      args: [employeeAddress],
    });
    assert.equal(
      await decryptAsEmployee(rateHandle),
      EMPLOYEE_RATE,
      "the employee could not read back their own salary rate",
    );

    const balanceHandle = await read<Hex>({
      address: record.contracts.confidentialPayoutToken,
      abi: abis.cToken,
      functionName: "confidentialBalanceOf",
      args: [employeeAddress],
    });
    const balance = await decryptAsEmployee(balanceHandle);
    assert.equal(balance, balanceBefore + paid);
    console.log(
      `  employee decrypted rate=${EMPLOYEE_RATE}/s and cUSDC balance=${balance}`,
    );
  });
});
