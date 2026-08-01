/**
 * Adversarial plaintext-leak detection.
 *
 * NoxStream's whole claim is "the salary never appears in the clear". This
 * module is the machinery that tries to falsify that claim, and it is used by
 * both the unit tests and the Sepolia e2e test.
 *
 * The method: take a secret integer, derive every plausible on-chain byte
 * encoding of it, and grep for those byte patterns in
 *   - every event topic and every event data blob of every transaction,
 *   - the raw calldata of every transaction,
 *   - `eth_getStorageAt` over the contracts' storage, including the slots that
 *     Solidity's mapping layout would put a per-employee value in.
 *
 * Two design points worth calling out, because a leak test that cannot fail is
 * worthless:
 *
 *  1. **The scanner is proven non-vacuous.** `assertNeedlesAreDetectable`
 *     feeds the scanner a haystack that genuinely contains the secret and
 *     asserts it fires. If the encoding logic were broken, every "no leak"
 *     assertion would trivially pass; this canary makes that impossible.
 *
 *  2. **Short needles are rejected, not silently accepted.** A 2-byte pattern
 *     appears by chance in random ciphertext, so `plaintextNeedles` refuses
 *     secrets whose minimal encoding is under `MIN_NEEDLE_HEX` nibbles. That
 *     keeps the test from being flaky *and* from being falsely reassuring.
 */
import assert from "node:assert/strict";
import {
  encodeAbiParameters,
  keccak256,
  numberToHex,
  toHex,
  type Address,
  type Hex,
  type Log,
  type TransactionReceipt,
} from "viem";

/**
 * Under 4 bytes, a coincidental match in *unpadded* ciphertext stops being
 * unlikely. Zero-padded needles are exempt: 13 consecutive zero nibbles do not
 * occur by chance in a Nox handle.
 */
const MIN_UNPADDED_NEEDLE_HEX = 8;

export interface Needle {
  /** e.g. `aliceSalary/uint256-be`. */
  label: string;
  /** Lowercase hex WITHOUT the 0x prefix. */
  hex: string;
}

export interface Haystack {
  /** Human-readable provenance, printed when a leak is found. */
  where: string;
  /** Hex blob, with or without 0x. */
  hex: string;
}

function strip(hex: string): string {
  return (hex.startsWith("0x") ? hex.slice(2) : hex).toLowerCase();
}

function minimalBigEndian(value: bigint): string {
  let h = value.toString(16);
  if (h.length % 2 === 1) h = `0${h}`;
  return h;
}

function reverseBytes(hex: string): string {
  const out: string[] = [];
  for (let i = hex.length - 2; i >= 0; i -= 2) out.push(hex.slice(i, i + 2));
  return out.join("");
}

/**
 * Every byte pattern that would betray `value` if it were stored or emitted in
 * the clear.
 *
 * Two families, because they catch different failure modes:
 *
 *  - **Zero-padded words** (32/16/8 bytes). Solidity storage slots and ABI
 *    encodings are word-aligned, so a plaintext salary sitting in a slot or an
 *    event argument appears as `0x00…0789`. Searching for the padded form is an
 *    *exact* match at any byte offset and works even for small numbers — which
 *    matters, because a realistic per-second salary rate (5,000 USDC/month is
 *    1,929 base units/second) is far too small to search for unpadded.
 *
 *  - **Unpacked forms** — minimal big-endian, minimal little-endian, and the
 *    decimal string as ASCII. These catch packed structs, non-word encodings
 *    and a value smuggled out through a `string` field. They collide with
 *    random ciphertext when they are short, so they are only emitted once the
 *    value is at least `MIN_UNPADDED_NEEDLE_HEX` nibbles wide. The omission is
 *    reported by `describeNeedles` rather than hidden.
 */
export function plaintextNeedles(label: string, value: bigint): Needle[] {
  if (value < 0n) throw new Error(`plaintextNeedles: negative value ${value}`);
  if (value === 0n) {
    throw new Error(
      `plaintextNeedles: 0 is not a secret worth scanning for — every empty ` +
        `storage slot would match it.`,
    );
  }

  const be = minimalBigEndian(value);
  const needles: Needle[] = [
    // Word-aligned forms: exact, and safe for small values.
    { label: `${label}/word32`, hex: strip(numberToHex(value, { size: 32 })) },
    { label: `${label}/word16`, hex: strip(numberToHex(value, { size: 16 })) },
    { label: `${label}/word8`, hex: strip(numberToHex(value, { size: 8 })) },
  ];

  if (be.length >= MIN_UNPADDED_NEEDLE_HEX) {
    needles.push(
      { label: `${label}/uint-be`, hex: be },
      { label: `${label}/uint-le`, hex: reverseBytes(be) },
    );
  }
  // 4+ decimal digits before ASCII search is worth doing.
  if (value >= 1000n) {
    needles.push({
      label: `${label}/decimal-ascii`,
      hex: strip(toHex(value.toString(10))),
    });
  }

  // De-duplicate (a byte-palindrome makes BE and LE identical; word8 ⊂ word32
  // only as a suffix, so all three widths are kept).
  const seen = new Set<string>();
  return needles.filter((n) => {
    if (seen.has(n.hex)) return false;
    seen.add(n.hex);
    return true;
  });
}

/** One line per secret, stating exactly which encodings are being searched for. */
export function describeNeedles(
  secrets: Array<{ label: string; value: bigint }>,
): string {
  return secrets
    .map(({ label, value }) => {
      const forms = plaintextNeedles(label, value).map((n) => n.label.split("/")[1]);
      const skipped =
        minimalBigEndian(value).length < MIN_UNPADDED_NEEDLE_HEX
          ? " (unpadded forms omitted: too short to distinguish from ciphertext)"
          : "";
      return `    ${label} = ${value} -> [${forms.join(", ")}]${skipped}`;
    })
    .join("\n");
}

/** Full 32-byte big-endian word — used as the canary haystack. */
export function word32(value: bigint): Hex {
  return numberToHex(value, { size: 32 });
}

export function findLeak(
  haystacks: Haystack[],
  needles: Needle[],
): { needle: Needle; haystack: Haystack } | undefined {
  for (const haystack of haystacks) {
    const hay = strip(haystack.hex);
    if (hay.length === 0) continue;
    for (const needle of needles) {
      if (hay.includes(needle.hex)) return { needle, haystack };
    }
  }
  return undefined;
}

/**
 * Proves the scanner would actually fire, needle by needle.
 *
 * Without this, a bug in the encoders would make every "no leak found"
 * assertion in the suite pass vacuously — the worst possible failure for a
 * privacy test, because it reports green while proving nothing. Each needle is
 * planted inside a random blob at a non-aligned offset and the scanner must
 * find it.
 */
export function assertNeedlesAreDetectable(needles: Needle[]): void {
  assert.ok(needles.length > 0, "Leak scanner self-test: no needles generated");

  // Fixed pseudo-random filler: deterministic runs, no crypto import needed.
  const filler = "9c1f7ab35e0d248c6b0af317d95e2b48";

  for (const needle of needles) {
    const planted: Haystack = {
      where: `canary:${needle.label}`,
      hex: `0x${filler}${needle.hex}${filler}`,
    };
    assert.ok(
      findLeak([planted], [needle]) !== undefined,
      `Leak scanner self-test FAILED for ${needle.label} (0x${needle.hex}): the ` +
        `scanner did not find the pattern in a blob that provably contains it. ` +
        `Every "no leak" assertion would be vacuous.`,
    );
  }

  // And the converse: a blob that does not contain any needle must not match,
  // or the scanner would be firing on everything.
  assert.equal(
    findLeak([{ where: "canary:clean", hex: `0x${filler.repeat(4)}` }], needles),
    undefined,
    `Leak scanner self-test FAILED: it reported a leak in a blob containing none.`,
  );
}

export function assertNoLeak(
  haystacks: Haystack[],
  needles: Needle[],
  context: string,
): void {
  const hit = findLeak(haystacks, needles);
  if (hit !== undefined) {
    assert.fail(
      `PLAINTEXT LEAK — ${context}\n` +
        `  secret pattern : ${hit.needle.label} = 0x${hit.needle.hex}\n` +
        `  found in       : ${hit.haystack.where}\n` +
        `  blob           : ${hit.haystack.hex}`,
    );
  }
}

/** Every hex field of a log: each topic, plus the data blob. */
export function haystacksFromLog(log: Log, where: string): Haystack[] {
  const out: Haystack[] = [];
  log.topics.forEach((t, i) => out.push({ where: `${where} topic[${i}]`, hex: t }));
  out.push({ where: `${where} data`, hex: log.data });
  return out;
}

/**
 * Every hex field of a transaction that an observer can read: the calldata it
 * was sent with, and every field of every log it produced.
 *
 * Scanning calldata matters as much as scanning logs — an implementation that
 * accepted a plaintext salary as a `uint256` argument and only *stored* it
 * encrypted would still have published the number to the world in the tx input.
 */
export async function haystacksFromTx(
  publicClient: {
    getTransaction: (args: { hash: Hex }) => Promise<{ input: Hex }>;
    getTransactionReceipt: (args: { hash: Hex }) => Promise<TransactionReceipt>;
  },
  hash: Hex,
  where: string,
): Promise<Haystack[]> {
  const [tx, receipt] = await Promise.all([
    publicClient.getTransaction({ hash }),
    publicClient.getTransactionReceipt({ hash }),
  ]);
  const out: Haystack[] = [{ where: `${where} calldata`, hex: tx.input }];
  receipt.logs.forEach((log, i) => {
    out.push(
      ...haystacksFromLog(log, `${where} log[${i}] (${log.address})`),
    );
  });
  return out;
}

export interface StorageScanOptions {
  /** Number of sequential slots from 0 to read. */
  slotCount?: number;
  /** Mapping keys to probe (typically employee addresses). */
  mappingKeys?: Address[];
  /** How many base slots to treat as potential mappings. */
  mappingSlotCount?: number;
  /** Extra words read after each computed mapping slot, for struct members. */
  structWords?: number;
}

/**
 * Reads a contract's storage the way an attacker would: sequential slots for
 * plain state variables, plus `keccak256(abi.encode(key, slot))` for every
 * plausible `mapping(address => ...)` base slot, plus a few following words to
 * catch structs and multi-word values.
 */
export async function scanStorage(
  publicClient: {
    getStorageAt: (args: {
      address: Address;
      slot: Hex;
    }) => Promise<Hex | undefined>;
  },
  address: Address,
  label: string,
  options: StorageScanOptions = {},
): Promise<Haystack[]> {
  const slotCount = options.slotCount ?? 24;
  const mappingSlotCount = options.mappingSlotCount ?? 24;
  const structWords = options.structWords ?? 3;
  const mappingKeys = options.mappingKeys ?? [];

  const reads: Array<{ where: string; slot: Hex }> = [];

  for (let i = 0; i < slotCount; i++) {
    reads.push({ where: `${label} storage slot ${i}`, slot: numberToHex(i, { size: 32 }) });
  }

  for (const key of mappingKeys) {
    for (let base = 0; base < mappingSlotCount; base++) {
      const location = keccak256(
        encodeAbiParameters(
          [{ type: "address" }, { type: "uint256" }],
          [key, BigInt(base)],
        ),
      );
      for (let w = 0; w < structWords; w++) {
        const slot = numberToHex(BigInt(location) + BigInt(w), { size: 32 });
        reads.push({
          where: `${label} storage mapping(slot ${base})[${key}] +${w}`,
          slot,
        });
      }
    }
  }

  const out: Haystack[] = [];
  const CHUNK = 16;
  for (let i = 0; i < reads.length; i += CHUNK) {
    const chunk = reads.slice(i, i + CHUNK);
    const values = await Promise.all(
      chunk.map((r) => publicClient.getStorageAt({ address, slot: r.slot })),
    );
    values.forEach((value, j) => {
      if (value !== undefined) out.push({ where: chunk[j].where, hex: value });
    });
  }
  return out;
}

const ZERO_WORD =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

/**
 * Asserts that what a public `view` returned is an opaque Nox handle and not a
 * number in disguise: 32 bytes, initialised, and — the assertion that actually
 * bites — not equal to the plaintext's own 32-byte encoding.
 */
export function assertIsHandle(
  value: unknown,
  label: string,
  opts: { notEqualTo?: bigint[] } = {},
): asserts value is Hex {
  assert.equal(
    typeof value,
    "string",
    `${label}: expected a 32-byte handle, got ${typeof value}`,
  );
  const hex = value as string;
  assert.match(
    hex,
    /^0x[0-9a-fA-F]{64}$/,
    `${label}: expected a 32-byte handle, got ${hex}`,
  );
  assert.notEqual(
    hex.toLowerCase(),
    ZERO_WORD,
    `${label}: handle is uninitialised (all zero) — the value was never stored, ` +
      `so any "it is encrypted" conclusion drawn from it would be false.`,
  );
  for (const plain of opts.notEqualTo ?? []) {
    assert.notEqual(
      hex.toLowerCase(),
      word32(plain).toLowerCase(),
      `${label}: the on-chain word equals the PLAINTEXT ${plain}. This is not a ` +
        `handle — the value is stored in the clear.`,
    );
  }
}
