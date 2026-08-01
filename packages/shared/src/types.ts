import type { Handle } from "./nox.js";

/** A payroll row as the employer enters it, before encryption. */
export interface RosterEntry {
  /** Payee address. PUBLIC on-chain by design. */
  employee: `0x${string}`;
  /** Human label — never leaves the browser, never touches the chain. */
  label?: string;
  /**
   * Gross salary per 30-day month, in the payout asset's smallest unit
   * (USDC has 6 decimals, so 5_000_000_000n == 5,000 USDC/month).
   * CONFIDENTIAL: encrypted before it is submitted.
   */
  monthlyAmount: bigint;
}

/** Seconds in the accrual month NoxStream bills against. */
export const SECONDS_PER_MONTH = 30n * 24n * 60n * 60n;

/**
 * Converts a monthly salary to the per-second rate the contracts store.
 *
 * Integer division truncates, so the stored rate is at most 1 unit/second below
 * the exact figure. Over a 30-day month that is a worst-case shortfall of
 * 2,592,000 base units — 2.59 USDC at 6 decimals. We therefore keep salaries in
 * the asset's smallest unit and document the rounding rather than hiding it.
 * Rounding *down* is deliberate: it can never over-pay the aggregate stream.
 */
export function toRatePerSecond(monthlyAmount: bigint): bigint {
  return monthlyAmount / SECONDS_PER_MONTH;
}

/**
 * The exact payload `encryptInput` produces. Every confidential write to
 * NoxStream carries this shape.
 *
 * `handle` is bound to a specific target contract at encryption time, so a
 * handle minted for the registry cannot be replayed against the payroll.
 */
export interface EncryptedInput {
  /** 32-byte pointer to the ciphertext. */
  handle: Handle;
  /** EIP-712 gateway attestation that the handle is legitimate. */
  handleProof: `0x${string}`;
}

/** One roster row, encrypted and ready to submit. */
export interface EncryptedAllocation {
  employee: `0x${string}`;
  encryptedRate: Handle;
  inputProof: `0x${string}`;
}

/**
 * What an observer can see vs. what the employee can see.
 *
 * The UI renders both at once — each row shows the handle the chain stores
 * beside whatever a real `decrypt()` returns for the connected account — and
 * the e2e leak test asserts the same split: everything in `PublicView` must be
 * readable from the chain, and nothing in `PrivateView` may appear anywhere in
 * a log, a calldata field or a storage slot.
 */
export interface PublicView {
  /** Aggregate stream total — visible, and meant to be. */
  aggregateFunded: bigint;
  aggregateHarvested: bigint;
  /** Roster addresses are public; their salaries are not. */
  employees: `0x${string}`[];
  /** All an observer gets per employee: an opaque handle. */
  opaqueRateHandles: Record<`0x${string}`, Handle>;
}

export interface PrivateView {
  employee: `0x${string}`;
  /** Decrypted only because the caller holds an ACL grant. */
  ratePerSecond: bigint;
  accrued: bigint;
  claimed: bigint;
  claimable: bigint;
}

/** Written by the deploy script; read by the frontend and the e2e tests. */
export interface DeploymentRecord {
  chainId: number;
  deployedAt: string;
  deployer: `0x${string}`;
  contracts: {
    payrollRegistry: `0x${string}`;
    noxStreamPayroll: `0x${string}`;
    confidentialPayoutToken: `0x${string}`;
    streamAdapter: `0x${string}`;
    payoutAsset: `0x${string}`;
  };
  nox: {
    noxComputeAddress: `0x${string}`;
    handleGatewayUrl: string;
  };
  /** Underlying public streaming protocol, e.g. "sablier-lockup-v2.0". */
  streamProtocol: string;
  txHashes: Record<string, `0x${string}`>;
}
