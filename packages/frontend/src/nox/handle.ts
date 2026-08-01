import type { Handle } from "@shared/nox";
import { isZeroHandle } from "@shared/nox";

/**
 * A Nox handle is structured, and its structure is public. Decoding it in the
 * browser is not a trick — it is exactly the information an observer has:
 *
 *   byte 0      version
 *   bytes 1..4  chain id
 *   byte 5      solidity type code
 *   byte 6      attribute (1 = freshly encrypted input, 0 = computed on-chain)
 *   bytes 7..31 opaque digest
 *
 * So the world learns "this is a uint256 on chain 11155111". It learns nothing
 * about the number. Showing that split is the point of the public view.
 *
 * Layout transcribed from @iexec-nox/handle@0.1.0-beta.13
 * `src/utils/types.ts` (handleToVersion / handleToChainId /
 * handleToSolidityType / handleToAttribute).
 */

const SOLIDITY_TYPES = [
  "bool",
  "address",
  "bytes",
  "string",
  ...Array.from({ length: 32 }, (_, i) => `uint${(i + 1) * 8}`),
  ...Array.from({ length: 32 }, (_, i) => `int${(i + 1) * 8}`),
  ...Array.from({ length: 32 }, (_, i) => `bytes${i + 1}`),
] as const;

export interface HandleMeta {
  version: number;
  chainId: number;
  solidityType: string | null;
  /** True for handles minted by `encryptInput`; false for computed results. */
  isFreshInput: boolean;
}

export function isHandle(value: unknown): value is Handle {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

export function decodeHandle(handle: string): HandleMeta | null {
  if (!isHandle(handle) || isZeroHandle(handle)) return null;
  const byte = (i: number) => Number.parseInt(handle.slice(2 + i * 2, 4 + i * 2), 16);
  const typeCode = byte(5);
  return {
    version: byte(0),
    chainId: Number.parseInt(handle.slice(4, 12), 16),
    solidityType: SOLIDITY_TYPES[typeCode] ?? null,
    isFreshInput: byte(6) === 1,
  };
}

/** `0x7f3a…e21b` — enough to identify a handle, useless for reading it. */
export function shortHandle(handle: string, lead = 6, tail = 4): string {
  if (!isHandle(handle)) return handle;
  return `${handle.slice(0, 2 + lead)}…${handle.slice(-tail)}`;
}

export function shortAddress(address: string, lead = 6, tail = 4): string {
  if (typeof address !== "string" || address.length < 12) return address;
  return `${address.slice(0, 2 + lead)}…${address.slice(-tail)}`;
}

export { isZeroHandle };
export type { Handle };
