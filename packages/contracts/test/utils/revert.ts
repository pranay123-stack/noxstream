/**
 * Custom-error assertions that survive Hardhat 3 + viem.
 *
 * `assert.rejects(fn, /NotEmployer/)` looks right and is unreliable here: when
 * EDR reports a revert during gas estimation it comes back as JSON-RPC -32602,
 * which viem surfaces as "Missing or invalid parameters." with the raw revert
 * data tucked into the details. The custom error's *name* never appears in the
 * message even though the ABI defines it, so a name-only matcher fails on a
 * transaction that reverted for exactly the right reason.
 *
 * So we match on the 4-byte selector, computed from the ABI, and accept the
 * name as well when viem did manage to decode it.
 */
import assert from "node:assert/strict";
import { keccak256, toHex, type Abi } from "viem";

function errorSelector(abi: Abi, name: string): string {
  const entry = (abi as unknown as Array<{ type?: string; name?: string; inputs?: Array<{ type: string }> }>).find(
    (e) => e.type === "error" && e.name === name,
  );
  if (entry === undefined) {
    throw new Error(
      `assertRevertsWith: the ABI declares no error named '${name}'. ` +
        `Declared errors: ${(abi as unknown as Array<{ type?: string; name?: string }>)
          .filter((e) => e.type === "error")
          .map((e) => e.name)
          .join(", ")}`,
    );
  }
  const signature = `${name}(${(entry.inputs ?? []).map((i) => i.type).join(",")})`;
  return keccak256(toHex(signature)).slice(0, 10);
}

/** Flattens an Error chain into one searchable string. */
function fullMessage(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current !== undefined && current !== null && depth < 10; depth++) {
    parts.push(String(current));
    if (typeof current === "object" && "cause" in current) {
      current = (current as { cause?: unknown }).cause;
    } else {
      break;
    }
  }
  return parts.join("\n");
}

export async function assertRevertsWith(
  fn: () => Promise<unknown>,
  abi: Abi,
  errorName: string,
): Promise<void> {
  const selector = errorSelector(abi, errorName);
  try {
    await fn();
  } catch (error) {
    const message = fullMessage(error);
    assert.ok(
      message.includes(errorName) || message.includes(selector),
      `expected a revert with ${errorName} (${selector}), got:\n${message}`,
    );
    return;
  }
  assert.fail(`expected a revert with ${errorName} (${selector}), but it succeeded`);
}
