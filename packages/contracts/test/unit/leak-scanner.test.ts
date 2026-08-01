/**
 * Tests for the leak scanner itself.
 *
 * The Sepolia e2e test's headline claim — "the salary appears nowhere in the
 * clear" — is only as trustworthy as the tool that looked for it. A scanner
 * with a broken encoder reports "no leak" on a chain that is leaking
 * everything, which is strictly worse than having no test at all. So the
 * scanner gets its own tests, and they run offline in milliseconds on every CI
 * push, independently of Docker, Nox, or a funded key.
 *
 * NOTE: this file must never touch the chain. `node:test` runs test files in
 * parallel worker processes and the Nox plugin binds port 8545 for its local
 * stack, so exactly one file in this project (test/unit/payroll.test.ts) may
 * connect to a network.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertIsHandle,
  assertNeedlesAreDetectable,
  assertNoLeak,
  findLeak,
  plaintextNeedles,
  word32,
} from "../utils/leak-scan.js";

const SALARY = 5_000_000_000n; // 5,000 USDC at 6 decimals
const RATE = SALARY / (30n * 24n * 60n * 60n); // 1929 base units/second

describe("leak scanner", () => {
  it("self-test passes for realistic salary and rate values", () => {
    const needles = [
      ...plaintextNeedles("salary", SALARY),
      ...plaintextNeedles("rate", RATE),
    ];
    assertNeedlesAreDetectable(needles);
  });

  it("finds a plaintext salary hidden in an ABI-encoded event argument", () => {
    const needles = plaintextNeedles("salary", SALARY);
    const eventData = `0x${"00".repeat(32)}${word32(SALARY).slice(2)}`;
    const hit = findLeak([{ where: "log data", hex: eventData }], needles);
    assert.ok(hit !== undefined, "scanner missed a word-aligned plaintext");
    assert.equal(hit.needle.label, "salary/word32");
  });

  it("finds a small per-second rate that padding would otherwise hide", () => {
    // 1929 is only 3 hex nibbles. An unpadded substring search cannot find it
    // reliably; the word-aligned needle can, which is why both exist.
    const needles = plaintextNeedles("rate", RATE);
    const storageSlot = word32(RATE);
    const hit = findLeak([{ where: "slot 7", hex: storageSlot }], needles);
    assert.ok(hit !== undefined, "scanner missed a small plaintext rate in storage");
  });

  it("finds a salary smuggled out as a decimal string", () => {
    const asAscii = Buffer.from(SALARY.toString(10), "utf8").toString("hex");
    const hit = findLeak(
      [{ where: "string field", hex: `0xdead${asAscii}beef` }],
      plaintextNeedles("salary", SALARY),
    );
    assert.ok(hit !== undefined, "scanner missed an ASCII-encoded plaintext");
    assert.equal(hit.needle.label, "salary/decimal-ascii");
  });

  it("finds a little-endian encoding", () => {
    // 5_000_000_000 = 0x012a05f200, so little-endian it is 0x00f2052a01.
    const hit = findLeak(
      [{ where: "packed blob", hex: "0x777700f2052a017777" }],
      plaintextNeedles("salary", SALARY),
    );
    assert.ok(hit !== undefined, "scanner missed a little-endian plaintext");
    assert.equal(hit.needle.label, "salary/uint-le");
  });

  it("does not fire on a genuine Nox handle", () => {
    // A real handle produced by the local stack during development.
    const handle =
      "0x0000007a692301a8ef2d4254a05355b2120f72cea50f012064cbb7b83b15062a";
    assertNoLeak(
      [{ where: "registry.ratePerSecondOf", hex: handle }],
      [...plaintextNeedles("salary", SALARY), ...plaintextNeedles("rate", RATE)],
      "handle must not be mistaken for a plaintext",
    );
  });

  it("refuses to scan for zero, which every empty slot would match", () => {
    assert.throws(() => plaintextNeedles("bad", 0n), /not a secret/);
  });

  it("rejects an all-zero handle as uninitialised rather than 'encrypted'", () => {
    assert.throws(
      () => assertIsHandle(`0x${"00".repeat(32)}`, "rate"),
      /uninitialised/,
    );
  });

  it("rejects an on-chain word that is actually the plaintext", () => {
    assert.throws(
      () => assertIsHandle(word32(RATE), "rate", { notEqualTo: [RATE] }),
      /stored in the clear/,
    );
  });

  it("accepts a real handle", () => {
    assertIsHandle(
      "0x0000007a692301a8ef2d4254a05355b2120f72cea50f012064cbb7b83b15062a",
      "rate",
      { notEqualTo: [RATE, SALARY] },
    );
  });
});
