/**
 * NoxStream unit tests — real contracts, real Nox stack, local chain.
 *
 * These run against the Nox offchain stack the Hardhat plugin boots in Docker,
 * so every encryption, every TEE computation and every ACL check is genuine.
 * Nothing here is stubbed except Sablier's Lockup core (see
 * contracts/mocks/MockSablierLockup.sol) and the payout ERC-20, both of which
 * are third-party contracts that simply do not exist on an ephemeral chain.
 *
 * IMPORTANT — this is the ONLY test file in the project that may touch a
 * network. `node:test` runs test files in parallel worker processes and the Nox
 * plugin binds port 8545 for its JSON-RPC relay, refusing to start a second
 * one. A second chain-touching file fails with "Port 8545 is already in use",
 * which reads like an unrelated environment problem.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import type { Address, Hex } from "viem";
import {
  deployScenario,
  fundAggregateStream,
  read,
  send,
  setAllocation,
  type Scenario,
} from "../utils/fixture.js";
import {
  assertIsHandle,
  assertNoLeak,
  haystacksFromTx,
  plaintextNeedles,
  scanStorage,
} from "../utils/leak-scan.js";
import {
  advanceTime,
  assertCannotDecrypt,
  handleClientFor,
  resolveAndDecrypt,
} from "../utils/nox.js";
import { assertRevertsWith } from "../utils/revert.js";

/** Local Docker stack: fast, but a full deploy + several TEE ops per test. */
const TIMEOUT = 300_000;

const USDC = 1_000_000n; // 1.00 USDC at 6 decimals
const SECONDS_PER_MONTH = 30n * 24n * 60n * 60n;

/** 5,000 USDC/month -> 1,929 base units/second (integer division, rounds down). */
const ALICE_MONTHLY = 5_000n * USDC;
const ALICE_RATE = ALICE_MONTHLY / SECONDS_PER_MONTH;
/** 9,000 USDC/month -> 3,472/second. Distinct from Alice's, deliberately. */
const BOB_MONTHLY = 9_000n * USDC;
const BOB_RATE = BOB_MONTHLY / SECONDS_PER_MONTH;

/**
 * One hour, so a few minutes of simulated time unlock a meaningful slice of the
 * aggregate. Real payroll streams run for a month; the maths is identical and
 * the short horizon keeps the suite inside the Nox proof-expiry budget.
 */
const STREAM_DURATION = 60 * 60;

/** Reads `payroll.lastAccrualAt(employee)` — the public accrual clock. */
async function lastAccrualAt(s: Scenario, employee: Address): Promise<bigint> {
  return read<bigint>(s, {
    address: s.addresses.noxStreamPayroll,
    abi: s.abis.noxStreamPayroll,
    functionName: "lastAccrualAt",
    args: [employee],
  });
}

async function blockTimestampOf(s: Scenario, txHash: Hex): Promise<bigint> {
  const receipt = await s.publicClient.getTransactionReceipt({ hash: txHash });
  const block = await s.publicClient.getBlock({
    blockNumber: receipt.blockNumber,
  });
  return block.timestamp;
}

async function rateHandle(s: Scenario, employee: Address): Promise<Hex> {
  return read<Hex>(s, {
    address: s.addresses.payrollRegistry,
    abi: s.abis.payrollRegistry,
    functionName: "ratePerSecondOf",
    args: [employee],
  });
}

async function cUsdcBalanceHandle(s: Scenario, who: Address): Promise<Hex> {
  return read<Hex>(s, {
    address: s.addresses.confidentialPayoutToken,
    abi: s.abis.confidentialPayoutToken,
    functionName: "confidentialBalanceOf",
    args: [who],
  });
}

/** Decrypts with the connection's default (employer) key. */
async function employerDecrypt(s: Scenario, handle: Hex): Promise<bigint> {
  return resolveAndDecrypt(s.noxClient, s.noxClient.handleGatewayUrl, handle);
}

/**
 * Decrypts as a specific account, proving the ACL grant belongs to them.
 * Uses the local-account signer, not the node-backed wallet — see
 * `handleClientFor` for why that distinction is load-bearing.
 */
async function decryptAs(
  s: Scenario,
  who: keyof Scenario["signers"],
  handle: Hex,
): Promise<bigint> {
  const client = await handleClientFor(s.signers[who], s.noxClient);
  return resolveAndDecrypt(client, s.noxClient.handleGatewayUrl, handle);
}

describe("NoxPayrollRegistry — access control", { timeout: TIMEOUT }, () => {
  let s: Scenario;

  before(async () => {
    s = await deployScenario();
  });

  it("records the deployer as the immutable employer", async () => {
    const employer = await read<Address>(s, {
      address: s.addresses.payrollRegistry,
      abi: s.abis.payrollRegistry,
      functionName: "employer",
    });
    assert.equal(
      employer.toLowerCase(),
      s.employer.account.address.toLowerCase(),
    );
  });

  it("wires the registry to the payroll at deploy time", async () => {
    // Without this the payroll holds no ACL grant on any rate handle, and
    // `claim()` reverts `NotAllowed` inside `Nox.safeMul` — a failure that
    // surfaces nowhere near its cause.
    const payroll = await read<Address>(s, {
      address: s.addresses.payrollRegistry,
      abi: s.abis.payrollRegistry,
      functionName: "payroll",
    });
    assert.equal(
      payroll.toLowerCase(),
      s.addresses.noxStreamPayroll.toLowerCase(),
    );
  });

  it("lets the employer add an employee and exposes the roster publicly", async () => {
    await setAllocation(s, s.alice.account.address, ALICE_RATE);

    assert.equal(
      await read<boolean>(s, {
        address: s.addresses.payrollRegistry,
        abi: s.abis.payrollRegistry,
        functionName: "isRegistered",
        args: [s.alice.account.address],
      }),
      true,
    );
    assert.equal(
      await read<bigint>(s, {
        address: s.addresses.payrollRegistry,
        abi: s.abis.payrollRegistry,
        functionName: "employeeCount",
      }),
      1n,
    );
    assert.equal(
      (
        await read<Address>(s, {
          address: s.addresses.payrollRegistry,
          abi: s.abis.payrollRegistry,
          functionName: "employeeAt",
          args: [0n],
        })
      ).toLowerCase(),
      s.alice.account.address.toLowerCase(),
    );
  });

  it("rejects setAllocation from a non-employer", async () => {
    // Encrypt as the outsider, bound to the registry, so the failure is
    // unambiguously the access check and not a bad proof.
    const outsiderNox = await handleClientFor(s.signers.outsider, s.noxClient);
    const enc = await outsiderNox.encryptInput(
      ALICE_RATE,
      "uint256",
      s.addresses.payrollRegistry,
    );
    await assertRevertsWith(
      () =>
        send(s, s.outsider, {
          address: s.addresses.payrollRegistry,
          abi: s.abis.payrollRegistry,
          functionName: "setAllocation",
          args: [s.outsider.account.address, enc.handle, enc.handleProof],
        }),
      s.abis.payrollRegistry,
      "NotEmployer",
    );
  });

  it("rejects revokeAllocation from a non-employer", async () => {
    await assertRevertsWith(
      () =>
        send(s, s.outsider, {
          address: s.addresses.payrollRegistry,
          abi: s.abis.payrollRegistry,
          functionName: "revokeAllocation",
          args: [s.alice.account.address],
        }),
      s.abis.payrollRegistry,
      "NotEmployer",
    );
  });

  it("rejects setPayroll from a non-employer", async () => {
    await assertRevertsWith(
      () =>
        send(s, s.outsider, {
          address: s.addresses.payrollRegistry,
          abi: s.abis.payrollRegistry,
          functionName: "setPayroll",
          args: [s.outsider.account.address],
        }),
      s.abis.payrollRegistry,
      "NotEmployer",
    );
  });

  it("rejects the zero address as an employee", async () => {
    const enc = await s.noxClient.encryptInput(
      ALICE_RATE,
      "uint256",
      s.addresses.payrollRegistry,
    );
    await assertRevertsWith(
      () =>
        send(s, s.employer, {
          address: s.addresses.payrollRegistry,
          abi: s.abis.payrollRegistry,
          functionName: "setAllocation",
          args: [
            "0x0000000000000000000000000000000000000000",
            enc.handle,
            enc.handleProof,
          ],
        }),
      s.abis.payrollRegistry,
      "EmployeeIsZeroAddress",
    );
  });

  it("reverts revokeAllocation for someone who was never hired", async () => {
    await assertRevertsWith(
      () =>
        send(s, s.employer, {
          address: s.addresses.payrollRegistry,
          abi: s.abis.payrollRegistry,
          functionName: "revokeAllocation",
          args: [s.outsider.account.address],
        }),
      s.abis.payrollRegistry,
      "NotRegistered",
    );
  });
});

describe("Encrypted allocation round-trip and ACL", { timeout: TIMEOUT }, () => {
  let s: Scenario;
  let setTx: Hex;

  before(async () => {
    s = await deployScenario();
    setTx = await setAllocation(s, s.alice.account.address, ALICE_RATE);
  });

  it("stores the rate as an opaque handle, not a number", async () => {
    const handle = await rateHandle(s, s.alice.account.address);
    assertIsHandle(handle, "registry.ratePerSecondOf(alice)", {
      notEqualTo: [ALICE_RATE, ALICE_MONTHLY],
    });
  });

  it("lets the employee decrypt their own salary", async () => {
    const handle = await rateHandle(s, s.alice.account.address);
    assert.equal(await decryptAs(s, "alice", handle), ALICE_RATE);
  });

  it("lets the employer decrypt it too, so payroll stays auditable", async () => {
    const handle = await rateHandle(s, s.alice.account.address);
    assert.equal(await employerDecrypt(s, handle), ALICE_RATE);
  });

  it("REFUSES a third party — no ACL grant, no decryption", async () => {
    const handle = await rateHandle(s, s.alice.account.address);
    const outsiderNox = await handleClientFor(s.signers.outsider, s.noxClient);
    const message = await assertCannotDecrypt(
      outsiderNox,
      handle,
      `outsider ${s.outsider.account.address}`,
    );
    // Recorded so a regression that turns a hard failure into a silent
    // empty result is visible in the test output.
    console.log(`      outsider decrypt rejected: ${message.slice(0, 140)}`);
  });

  it("emits no plaintext in the setAllocation transaction", async () => {
    const needles = [
      ...plaintextNeedles("aliceRate", ALICE_RATE),
      ...plaintextNeedles("aliceMonthly", ALICE_MONTHLY),
    ];
    const haystacks = await haystacksFromTx(
      s.publicClient,
      setTx,
      "setAllocation",
    );
    assertNoLeak(haystacks, needles, "registry.setAllocation");
  });

  it("keeps no plaintext in registry storage", async () => {
    const needles = [
      ...plaintextNeedles("aliceRate", ALICE_RATE),
      ...plaintextNeedles("aliceMonthly", ALICE_MONTHLY),
    ];
    const haystacks = await scanStorage(
      s.publicClient,
      s.addresses.payrollRegistry,
      "NoxPayrollRegistry",
      { mappingKeys: [s.alice.account.address] },
    );
    assertNoLeak(haystacks, needles, "NoxPayrollRegistry storage");
  });
});

describe("Accrual, harvest and confidential claim", { timeout: TIMEOUT }, () => {
  let s: Scenario;

  before(async () => {
    s = await deployScenario();
  });

  it("pays exactly rate x elapsed, and only the employee can read it", async () => {
    const alice = s.alice.account.address;

    // 1. Hire. `setAllocation` settles first, anchoring Alice's accrual clock.
    const setTx = await setAllocation(s, alice, ALICE_RATE);
    const anchor = await lastAccrualAt(s, alice);
    assert.notEqual(anchor, 0n, "accrual clock was not anchored on hire");

    // 2. Fund ONE public aggregate stream. Entirely visible, by design.
    const budget = 40_000n * USDC;
    await fundAggregateStream(s, budget, STREAM_DURATION);

    // 3. Let time pass, then harvest into the confidential vault. The advance
    //    is minutes, not days, because it is charged against the Nox input
    //    proof's one-hour expiry — see advanceTime() in test/utils/nox.ts.
    await advanceTime(s.connection, 300);
    const harvestTx = await send(s, s.employer, {
      address: s.addresses.noxStreamPayroll,
      abi: s.abis.noxStreamPayroll,
      functionName: "harvest",
    });
    const harvested = await read<bigint>(s, {
      address: s.addresses.payoutAsset,
      abi: s.abis.payoutAsset,
      functionName: "balanceOf",
      args: [s.addresses.confidentialPayoutToken],
    });
    assert.ok(harvested > 0n, "nothing was harvested from the public stream");

    // 4. Alice claims. Her entitlement is well under the harvested aggregate,
    //    so no clamp applies and the payment is her exact accrual.
    const claimTx = await send(s, s.alice, {
      address: s.addresses.noxStreamPayroll,
      abi: s.abis.noxStreamPayroll,
      functionName: "claim",
    });
    const claimTs = await blockTimestampOf(s, claimTx);
    const startedAt = await read<bigint>(s, {
      address: s.addresses.noxStreamPayroll,
      abi: s.abis.noxStreamPayroll,
      functionName: "startedAt",
    });
    const from = anchor > startedAt ? anchor : startedAt;
    const expected = ALICE_RATE * (claimTs - from);
    assert.ok(
      expected < harvested,
      `test setup error: entitlement ${expected} must be below the harvested ` +
        `${harvested} for this to be the un-clamped path`,
    );

    // 5. The employee's confidential balance is exactly her accrual.
    const balanceHandle = await cUsdcBalanceHandle(s, alice);
    assertIsHandle(balanceHandle, "cUSDC.confidentialBalanceOf(alice)", {
      notEqualTo: [expected, ALICE_RATE],
    });
    assert.equal(await decryptAs(s, "alice", balanceHandle), expected);

    // ...and the bookkeeping agrees.
    const claimedHandle = await read<Hex>(s, {
      address: s.addresses.noxStreamPayroll,
      abi: s.abis.noxStreamPayroll,
      functionName: "confidentialClaimedOf",
      args: [alice],
    });
    assert.equal(await decryptAs(s, "alice", claimedHandle), expected);

    // 6. Nothing about the amount escaped into any transaction of the flow.
    const needles = [
      ...plaintextNeedles("aliceRate", ALICE_RATE),
      ...plaintextNeedles("aliceClaim", expected),
    ];
    for (const [label, hash] of [
      ["setAllocation", setTx],
      ["claim", claimTx],
    ] as const) {
      assertNoLeak(
        await haystacksFromTx(s.publicClient, hash, label),
        needles,
        `${label} transaction`,
      );
    }

    // The harvest is the ONE place a plaintext amount is public, and that is
    // deliberate: it is the aggregate, which keeps the stream auditable. Assert
    // that it really is aggregate-only by checking it does not equal any single
    // employee's entitlement.
    const harvestLogs = await haystacksFromTx(
      s.publicClient,
      harvestTx,
      "harvest",
    );
    assert.notEqual(
      harvested,
      expected,
      "the public harvest amount equals Alice's private entitlement — with a " +
        "single claimant that would disclose it",
    );
    assertNoLeak(
      harvestLogs,
      plaintextNeedles("aliceRate", ALICE_RATE),
      "harvest transaction must not carry a per-employee rate",
    );

    // 7. And a third party still cannot read her balance.
    const outsiderNox = await handleClientFor(s.signers.outsider, s.noxClient);
    await assertCannotDecrypt(outsiderNox, balanceHandle, "outsider");
  });
});

describe("The clamp: an over-claim settles, it does not revert", { timeout: TIMEOUT }, () => {
  let s: Scenario;

  before(async () => {
    s = await deployScenario();
  });

  it("pays the vault balance, not the entitlement, and still succeeds", async () => {
    const alice = s.alice.account.address;

    // A deliberately huge rate so the entitlement dwarfs anything the stream
    // can have unlocked: 1,000 USDC per second.
    const hugeRate = 1_000n * USDC;
    await setAllocation(s, alice, hugeRate);
    const anchor = await lastAccrualAt(s, alice);

    // Fund a small budget over a long horizon so very little unlocks.
    const budget = 1_000n * USDC;
    // A long horizon so only a sliver has unlocked when the claim lands.
    await fundAggregateStream(s, budget, 365 * 24 * 60 * 60);
    await advanceTime(s.connection, 120);

    await send(s, s.employer, {
      address: s.addresses.noxStreamPayroll,
      abi: s.abis.noxStreamPayroll,
      functionName: "harvest",
    });
    const vault = await read<bigint>(s, {
      address: s.addresses.payoutAsset,
      abi: s.abis.payoutAsset,
      functionName: "balanceOf",
      args: [s.addresses.confidentialPayoutToken],
    });
    assert.ok(vault > 0n, "nothing was harvested");

    // The claim MUST NOT revert. A revert here would be a public side channel
    // announcing "this employee's entitlement exceeds the vault balance" — an
    // observable inequality over a private number.
    const claimTx = await send(s, s.alice, {
      address: s.addresses.noxStreamPayroll,
      abi: s.abis.noxStreamPayroll,
      functionName: "claim",
    });
    const claimTs = await blockTimestampOf(s, claimTx);
    const startedAt = await read<bigint>(s, {
      address: s.addresses.noxStreamPayroll,
      abi: s.abis.noxStreamPayroll,
      functionName: "startedAt",
    });
    const from = anchor > startedAt ? anchor : startedAt;
    const entitlement = hugeRate * (claimTs - from);
    assert.ok(
      entitlement > vault,
      `test setup error: entitlement ${entitlement} must exceed the vault ` +
        `balance ${vault} for this to test the clamp`,
    );

    // Paid exactly the vault balance — clamped, not reverted, not overdrawn.
    const balance = await decryptAs(
      s,
      "alice",
      await cUsdcBalanceHandle(s, alice),
    );
    assert.equal(
      balance,
      vault,
      `clamp failed: expected the full vault balance ${vault}, got ${balance}`,
    );

    // Bookkeeping records what was actually paid, not what was owed. Otherwise
    // the shortfall would be silently written off.
    const claimed = await decryptAs(
      s,
      "alice",
      await read<Hex>(s, {
        address: s.addresses.noxStreamPayroll,
        abi: s.abis.noxStreamPayroll,
        functionName: "confidentialClaimedOf",
        args: [alice],
      }),
    );
    assert.equal(claimed, vault);

    // The accrual is untouched by the clamp: the shortfall stays owed.
    const accrued = await decryptAs(
      s,
      "alice",
      await read<Hex>(s, {
        address: s.addresses.noxStreamPayroll,
        abi: s.abis.noxStreamPayroll,
        functionName: "confidentialAccruedOf",
        args: [alice],
      }),
    );
    assert.equal(
      accrued,
      entitlement,
      "the unpaid remainder must stay accrued and claimable later",
    );

    // Even the clamped claim discloses nothing.
    assertNoLeak(
      await haystacksFromTx(s.publicClient, claimTx, "clampedClaim"),
      [
        ...plaintextNeedles("hugeRate", hugeRate),
        ...plaintextNeedles("entitlement", entitlement),
      ],
      "clamped claim transaction",
    );
  });

  it("a second claim with an empty vault also succeeds and pays zero", async () => {
    // The vault was drained by the previous claim. This must still not revert:
    // "you got nothing" and "you got paid" have to be indistinguishable.
    const before = await decryptAs(
      s,
      "alice",
      await cUsdcBalanceHandle(s, s.alice.account.address),
    );
    await send(s, s.alice, {
      address: s.addresses.noxStreamPayroll,
      abi: s.abis.noxStreamPayroll,
      functionName: "claim",
    });
    const after = await decryptAs(
      s,
      "alice",
      await cUsdcBalanceHandle(s, s.alice.account.address),
    );
    assert.equal(after, before, "an unfunded claim must move nothing");
  });
});

describe("A raise does not re-price seconds already worked", { timeout: TIMEOUT }, () => {
  let s: Scenario;

  before(async () => {
    s = await deployScenario();
  });

  it("books the old rate up to the change and the new rate after", async () => {
    const alice = s.alice.account.address;

    await setAllocation(s, alice, ALICE_RATE);
    const t0 = await lastAccrualAt(s, alice);

    await fundAggregateStream(s, 100_000n * USDC, STREAM_DURATION);
    await advanceTime(s.connection, 180);

    // The raise. `setAllocation` calls `settle` first, so everything worked so
    // far is booked at the OLD rate before the new one lands.
    await setAllocation(s, alice, BOB_RATE);
    const t1 = await lastAccrualAt(s, alice);
    assert.ok(t1 > t0, "the accrual clock did not advance across the raise");

    await advanceTime(s.connection, 120);
    await send(s, s.employer, {
      address: s.addresses.noxStreamPayroll,
      abi: s.abis.noxStreamPayroll,
      functionName: "harvest",
    });

    const claimTx = await send(s, s.alice, {
      address: s.addresses.noxStreamPayroll,
      abi: s.abis.noxStreamPayroll,
      functionName: "claim",
    });
    const t2 = await blockTimestampOf(s, claimTx);

    const expected = ALICE_RATE * (t1 - t0) + BOB_RATE * (t2 - t1);
    const naiveIfRepriced = BOB_RATE * (t2 - t0);
    assert.notEqual(
      expected,
      naiveIfRepriced,
      "test setup error: the two interpretations must differ to be meaningful",
    );

    const paid = await decryptAs(s, "alice", await cUsdcBalanceHandle(s, alice));
    assert.equal(
      paid,
      expected,
      `expected old-rate x ${t1 - t0}s + new-rate x ${t2 - t1}s = ${expected}, ` +
        `got ${paid} (a full re-price would have been ${naiveIfRepriced})`,
    );
  });
});

describe("Revoking stops accrual but not entitlement", { timeout: TIMEOUT }, () => {
  let s: Scenario;

  before(async () => {
    s = await deployScenario();
  });

  it("keeps the leaver on the roster so earned salary stays claimable", async () => {
    const alice = s.alice.account.address;

    await setAllocation(s, alice, ALICE_RATE);
    const t0 = await lastAccrualAt(s, alice);

    await fundAggregateStream(s, 100_000n * USDC, STREAM_DURATION);
    await advanceTime(s.connection, 180);

    const revokeTx = await send(s, s.employer, {
      address: s.addresses.payrollRegistry,
      abi: s.abis.payrollRegistry,
      functionName: "revokeAllocation",
      args: [alice],
    });
    const t1 = await blockTimestampOf(s, revokeTx);

    // Still registered (so `claim` works), no longer active (so nothing accrues).
    assert.equal(
      await read<boolean>(s, {
        address: s.addresses.payrollRegistry,
        abi: s.abis.payrollRegistry,
        functionName: "isRegistered",
        args: [alice],
      }),
      true,
      "a leaver removed from the roster would lose already-earned salary",
    );
    assert.equal(
      await read<boolean>(s, {
        address: s.addresses.payrollRegistry,
        abi: s.abis.payrollRegistry,
        functionName: "isActive",
        args: [alice],
      }),
      false,
    );

    // More time passes after the revoke — it must not add anything.
    await advanceTime(s.connection, 180);
    await send(s, s.employer, {
      address: s.addresses.noxStreamPayroll,
      abi: s.abis.noxStreamPayroll,
      functionName: "harvest",
    });
    await send(s, s.alice, {
      address: s.addresses.noxStreamPayroll,
      abi: s.abis.noxStreamPayroll,
      functionName: "claim",
    });

    const paid = await decryptAs(s, "alice", await cUsdcBalanceHandle(s, alice));
    assert.equal(
      paid,
      ALICE_RATE * (t1 - t0),
      "a revoked employee must be paid for exactly the seconds worked before " +
        "the revoke, and nothing after",
    );
  });
});
