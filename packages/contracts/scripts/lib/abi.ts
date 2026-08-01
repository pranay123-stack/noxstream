/**
 * ABI introspection helpers used by the deploy script.
 *
 * ## Why the deploy script introspects instead of hardcoding
 *
 * NoxStream's contracts are written against the interfaces in
 * `contracts/interfaces/`, which pin the *behaviour* but deliberately say
 * nothing about constructor shape — an interface cannot. Several people build
 * against those interfaces in parallel, so the deploy script resolves
 * constructor arguments **by parameter name** out of a dictionary of known
 * values rather than by blind position.
 *
 * Two properties matter here:
 *   1. It is order-independent, so `(asset, treasury)` and `(treasury, asset)`
 *      both deploy correctly.
 *   2. When it cannot resolve something it fails *loudly* with the real
 *      constructor signature and the names it knows, instead of silently
 *      deploying a contract with the wrong wiring. A payroll contract wired to
 *      the wrong registry would still "work" right up until it paid the wrong
 *      person.
 */
import type { Abi } from "viem";

export interface AbiParam {
  name: string;
  type: string;
  internalType?: string;
  components?: AbiParam[];
}

interface AbiConstructor {
  type: "constructor";
  inputs?: AbiParam[];
}

interface AbiFunction {
  type: "function";
  name: string;
  inputs?: AbiParam[];
  outputs?: AbiParam[];
  stateMutability?: string;
}

/** One candidate value plus every parameter name it is willing to answer to. */
export interface ArgCandidate {
  /** Canonical label, used in diagnostics. */
  label: string;
  /** Accepted parameter names (compared after normalisation). */
  aliases: string[];
  value: unknown;
}

/** `_underlyingToken_` -> `underlyingtoken`. */
function normalise(name: string): string {
  return name.replace(/^_+|_+$/g, "").toLowerCase();
}

export function constructorInputs(abi: Abi): AbiParam[] {
  const ctor = (abi as unknown as Array<{ type?: string }>).find(
    (e) => e.type === "constructor",
  ) as AbiConstructor | undefined;
  return ctor?.inputs ?? [];
}

export function abiFunctions(abi: Abi): AbiFunction[] {
  return (abi as unknown as Array<{ type?: string }>).filter(
    (e) => e.type === "function",
  ) as AbiFunction[];
}

export function findFunction(
  abi: Abi,
  names: string[],
  arity?: number,
): AbiFunction | undefined {
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  return abiFunctions(abi).find(
    (f) =>
      wanted.has(f.name.toLowerCase()) &&
      (arity === undefined || (f.inputs?.length ?? 0) === arity),
  );
}

export function hasFunction(abi: Abi, name: string, arity?: number): boolean {
  return findFunction(abi, [name], arity) !== undefined;
}

function formatSignature(contractName: string, inputs: AbiParam[]): string {
  return `${contractName}(${inputs
    .map((i) => `${i.type} ${i.name || "<unnamed>"}`)
    .join(", ")})`;
}

function typeLooksCompatible(type: string, value: unknown): boolean {
  if (type === "address") {
    return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
  }
  if (type === "string") return typeof value === "string";
  if (type === "bool") return typeof value === "boolean";
  if (/^u?int\d*$/.test(type)) {
    return typeof value === "bigint" || typeof value === "number";
  }
  // bytes / arrays / tuples: no cheap check, let the encoder complain.
  return true;
}

/**
 * Resolves constructor arguments for `contractName` by matching each parameter
 * name against `candidates`.
 *
 * `address` parameters are additionally matched by *type* when exactly one
 * unused address candidate remains — a common, unambiguous case (e.g. a
 * one-argument `constructor(IERC20 x)` whose parameter someone named `x`).
 * Anything still unresolved throws with the full signature.
 */
export function resolveConstructorArgs(
  contractName: string,
  abi: Abi,
  candidates: ArgCandidate[],
): unknown[] {
  const inputs = constructorInputs(abi);
  if (inputs.length === 0) return [];

  // A candidate with no value is not a candidate — let the parameter surface as
  // unresolved (with a real diagnostic) rather than matching and then failing a
  // type check with a confusing message.
  const usable = candidates.filter((c) => c.value !== undefined);

  const byAlias = new Map<string, ArgCandidate>();
  for (const c of usable) {
    for (const alias of c.aliases) byAlias.set(normalise(alias), c);
  }

  const resolved: Array<{ input: AbiParam; candidate?: ArgCandidate }> =
    inputs.map((input) => ({
      input,
      candidate: byAlias.get(normalise(input.name ?? "")),
    }));

  // Single unambiguous address fallback.
  const unresolvedAddresses = resolved.filter(
    (r) => r.candidate === undefined && r.input.type === "address",
  );
  if (unresolvedAddresses.length === 1) {
    const used = new Set(
      resolved.map((r) => r.candidate?.label).filter(Boolean),
    );
    const freeAddressCandidates = usable.filter(
      (c) =>
        !used.has(c.label) &&
        typeof c.value === "string" &&
        /^0x[0-9a-fA-F]{40}$/.test(c.value),
    );
    if (freeAddressCandidates.length === 1) {
      unresolvedAddresses[0].candidate = freeAddressCandidates[0];
    }
  }

  const unresolved = resolved.filter((r) => r.candidate === undefined);
  if (unresolved.length > 0) {
    throw new Error(
      [
        `Cannot resolve constructor arguments for ${formatSignature(contractName, inputs)}.`,
        `Unresolved parameters: ${unresolved
          .map((u) => `${u.input.type} ${u.input.name || "<unnamed>"}`)
          .join(", ")}`,
        `Known argument names: ${usable
          .map((c) => `${c.label} [${c.aliases.join("|")}]`)
          .join("; ")}`,
        `Fix: rename the constructor parameter, or add the name as an alias in scripts/lib/deploy-system.ts.`,
      ].join("\n  "),
    );
  }

  return resolved.map(({ input, candidate }) => {
    const value = candidate!.value;
    if (!typeLooksCompatible(input.type, value)) {
      throw new Error(
        `Constructor argument type mismatch in ${formatSignature(contractName, inputs)}: ` +
          `parameter '${input.name}' is ${input.type} but matched candidate '${candidate!.label}' ` +
          `whose value is ${JSON.stringify(String(value))}.`,
      );
    }
    return value;
  });
}
