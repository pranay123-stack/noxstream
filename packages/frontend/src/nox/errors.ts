import {
  BaseError,
  ContractFunctionRevertedError,
  UserRejectedRequestError,
} from "viem";
import { HandleNotResolvedError } from "./gateway";

export type ErrorKind =
  | "rejected"
  | "unauthorised"
  | "timeout"
  | "revert"
  | "network"
  | "unknown";

export interface FriendlyError {
  kind: ErrorKind;
  title: string;
  detail: string;
  /** Raw message, shown behind a disclosure for anyone who wants it. */
  raw: string;
  /** True when the situation is the system behaving correctly, not a fault. */
  expected: boolean;
}

/** Revert reasons the interfaces declare, translated into what to do next. */
const REVERT_COPY: Record<string, { title: string; detail: string }> = {
  NotEmployer: {
    title: "This account is not the employer",
    detail:
      "Only the address that deployed the roster can set or revoke allocations. Switch to the employer account and try again.",
  },
  NotRegistered: {
    title: "This account is not on the roster",
    detail:
      "The employer has to add your address to the payroll registry before anything can accrue to it.",
  },
  AlreadyRegistered: {
    title: "That address is already on the roster",
    detail: "Update the existing allocation instead of adding a second one.",
  },
  EmployeeIsZeroAddress: {
    title: "Employee address is empty",
    detail: "One of the roster rows has the zero address. Fix it and resubmit.",
  },
  PayrollNotStarted: {
    title: "Payroll has not started",
    detail:
      "Accrual begins when the employer calls start(). Nothing can be claimed before that — and nothing is being lost, the clock simply has not been started.",
  },
  AlreadyStarted: {
    title: "Payroll is already running",
    detail: "start() can only be called once. The accrual clock is already ticking.",
  },
  VaultUnfunded: {
    title: "The vault has nothing to pay out yet",
    detail:
      "Money has unlocked in the public stream, but nobody has moved it into the private vault yet. Anyone may do that, including you, right here, without waiting for the employer. harvest() is permissionless.",
  },
  NothingToHarvest: {
    title: "Nothing unlocked yet",
    detail:
      "The public stream has released nothing since the last time funds were moved. It unlocks gradually — wait a moment and try again.",
  },
  ArrayLengthMismatch: {
    title: "Batch arrays do not line up",
    detail:
      "The employees, handles and proofs lists must be the same length. Re-encrypt the roster and resubmit.",
  },
  IndexOutOfBounds: {
    title: "Roster index out of range",
    detail: "The roster changed while it was being read. Refresh and try again.",
  },
  PayrollIsZeroAddress: {
    title: "Registry is not wired to a payroll contract",
    detail:
      "setPayroll() has not been called on the registry, so allocations have nowhere to settle. This is a deployment step, not something you can fix from this screen.",
  },
  AssetMismatch: {
    title: "Payout asset mismatch",
    detail:
      "The stream adapter streams a different ERC-20 than the confidential token wraps. These contracts were not deployed as a matched set.",
  },
  ZeroAddress: {
    title: "A required address is zero",
    detail: "One of the contract wiring parameters was never set.",
  },
  NotTreasury: {
    title: "This account cannot fund the stream",
    detail:
      "The stream adapter only accepts funding from the treasury address it was deployed with.",
  },
  StreamAlreadyOpen: {
    title: "A stream is already open",
    detail:
      "NoxStream funds exactly one public stream. Drain the current one before opening another.",
  },
  NoStream: {
    title: "No stream has been funded",
    detail: "Open and fund the public stream first — there is nothing to move yet.",
  },
  InsufficientFeeTank: {
    title: "The adapter has run out of ETH for the withdrawal fee",
    detail:
      "Sablier charges a small fee in ETH every time funds are pulled out of the stream, and the adapter cannot cover the next one. Anyone may refill it — the adapter's receive() is open, so an employee is never blocked on the employer here.",
  },
  ZeroDuration: {
    title: "Stream duration must be greater than zero",
    detail: "Pick a number of days for the stream to unlock over.",
  },
  AmountTooLarge: {
    title: "Amount is too large for the stream",
    detail:
      "Sablier stores deposits as uint128. Split the funding into smaller streams.",
  },
  UnauthorizedDestination: {
    title: "Funds can only be moved into the NoxStream vault",
    detail:
      "The adapter only ever pushes funds to the vault it was deployed with. That single constraint is what makes letting anyone move them safe.",
  },
  EthTransferFailed: {
    title: "ETH transfer failed",
    detail: "The receiving account rejected the transfer.",
  },
};

export function describeError(error: unknown): FriendlyError {
  const raw = rawMessage(error);

  if (error instanceof HandleNotResolvedError) {
    return {
      kind: "timeout",
      title: "Nox is still computing this value",
      detail:
        "The handle exists on-chain but the ciphertext behind it has not finished being produced. This is normal on a shared testnet — nothing is broken. Try again in a moment.",
      raw,
      expected: true,
    };
  }

  if (isAbort(error)) {
    return {
      kind: "rejected",
      title: "Cancelled",
      detail: "The operation was stopped before it finished.",
      raw,
      expected: true,
    };
  }

  if (isUserRejection(error)) {
    return {
      kind: "rejected",
      title: "You declined the request in your wallet",
      detail:
        "Nothing was sent and nothing was decrypted. Run it again when you are ready.",
      raw,
      expected: true,
    };
  }

  if (/not authorized to decrypt|does not exist or user/i.test(raw)) {
    return {
      kind: "unauthorised",
      title: "This account was never given permission to read that value",
      detail:
        "Nox checked its on-chain access list and this address is not on it. That is the system working correctly: the pointer is public, the number behind it is not. Only the employer and the employee the value belongs to are granted access.",
      raw,
      expected: true,
    };
  }

  const reverted = walk(error, ContractFunctionRevertedError);
  if (reverted) {
    const name = reverted.data?.errorName ?? reverted.reason ?? "";
    const copy = REVERT_COPY[name];
    if (copy) {
      return { kind: "revert", ...copy, raw, expected: true };
    }
    return {
      kind: "revert",
      title: "The contract rejected this transaction",
      detail: name
        ? `It reverted with \`${name}\`.`
        : "It reverted without a reason string.",
      raw,
      expected: false,
    };
  }

  if (/insufficient funds/i.test(raw)) {
    return {
      kind: "network",
      title: "Not enough Sepolia ETH for gas",
      detail:
        "Top the account up from a Sepolia faucet — the transaction itself is cheap.",
      raw,
      expected: true,
    };
  }

  if (/fetch|network|failed to fetch|gateway returned|timeout|ECONN/i.test(raw)) {
    return {
      kind: "network",
      title: "Could not reach the Nox handle gateway",
      detail:
        "The gateway or the RPC endpoint did not answer. Check your connection and retry; nothing was lost.",
      raw,
      expected: false,
    };
  }

  return {
    kind: "unknown",
    title: "Something went wrong",
    detail: firstLine(raw),
    raw,
    expected: false,
  };
}

function isUserRejection(error: unknown): boolean {
  if (walk(error, UserRejectedRequestError)) return true;
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 4001) return true;
  return /user rejected|user denied|rejected the request/i.test(rawMessage(error));
}

function isAbort(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error as { name?: string } | null)?.name === "AbortError"
  );
}

function walk<T>(
  error: unknown,
  ctor: abstract new (...args: never[]) => T,
): T | null {
  if (error instanceof BaseError) {
    const found = error.walk((e) => e instanceof ctor);
    return found instanceof ctor ? (found as T) : null;
  }
  return error instanceof ctor ? (error as T) : null;
}

function rawMessage(error: unknown): string {
  if (error instanceof Error) {
    const causeMessage =
      error.cause instanceof Error ? ` — ${error.cause.message}` : "";
    return `${error.message}${causeMessage}`;
  }
  return String(error);
}

function firstLine(message: string): string {
  return message.split("\n")[0]?.trim() || "No further detail was reported.";
}
