import { useEffect, useState } from "react";
import { isZeroHandle, type Handle } from "@shared/nox";
import { SECONDS_PER_MONTH } from "@shared/types";
import { DECRYPT_STAGE_LABEL, useDecryption } from "@/nox/DecryptionProvider";
import { formatAmount, formatSeconds } from "@/lib/format";
import { HandleChip } from "./HandleChip";
import { Button } from "./ui";
import { ArrowRightIcon, LockIcon, UnlockIcon } from "./icons";

/**
 * One on-chain value, showing both of its faces at once.
 *
 *   [ 0x1f3a…9b21 ]  →  4,200.00 USDC / month     ← this account holds a grant
 *   [ 0x8c04…2ee7 ]  →  Not authorised            ← it does not
 *
 * The 32-byte handle is ALWAYS on the left, because that is genuinely all the
 * chain stores. What appears on the right is decided by NoxCompute's access
 * list, not by anything in this file: an `isViewer(handle, you)` read runs
 * first, and a row the ACL excludes never even asks for a signature.
 *
 * That is why the toggle could go. The proof used to be the contrast between
 * two modes; it is now the contrast between two rows of the same table, which
 * is stronger — nobody has to take our word for what the "public view" would
 * have shown, because it is on screen next to the number the whole time.
 */

export type ValueKind = "rate" | "amount";

export function ConfidentialValue({
  handle,
  decimals,
  symbol,
  kind = "amount",
  /** Decrypt without being asked. Only ever set for the connected account's own values. */
  auto = false,
}: {
  handle: Handle | undefined;
  decimals: number;
  symbol: string;
  kind?: ValueKind;
  auto?: boolean;
}) {
  const { entryFor, request } = useDecryption();
  const entry = entryFor(handle);

  useEffect(() => {
    if (!auto || !handle) return;
    if (entry.stage === "idle") void request(handle);
  }, [auto, handle, entry.stage, request]);

  // Nothing has been written here yet, so there is no second half to show —
  // the chip itself renders "not set".
  if (!handle || isZeroHandle(handle) || entry.stage === "uninitialised") {
    return <HandleChip handle={handle} />;
  }

  return (
    <span className="cvalue">
      <HandleChip handle={handle} />
      <ArrowRightIcon size={13} className="cvalue-arrow" />
      <span className="cvalue-out">
        <Outcome
          entry={entry}
          handle={handle}
          decimals={decimals}
          symbol={symbol}
          kind={kind}
          onRetry={() => void request(handle)}
        />
      </span>
    </span>
  );
}

function Outcome({
  entry,
  handle,
  decimals,
  symbol,
  kind,
  onRetry,
}: {
  entry: ReturnType<ReturnType<typeof useDecryption>["entryFor"]>;
  handle: Handle;
  decimals: number;
  symbol: string;
  kind: ValueKind;
  onRetry: () => void;
}) {
  switch (entry.stage) {
    case "done":
      return (
        <DecryptedValue
          value={entry.value ?? 0n}
          decimals={decimals}
          symbol={symbol}
          kind={kind}
          handle={handle}
        />
      );

    case "unauthorised":
      return <NotAuthorised />;

    case "error":
      return (
        <>
          <span className="tiny" style={{ color: "var(--danger)" }}>
            {entry.error?.title ?? "Decryption failed"}
          </span>
          <span>
            <Button size="sm" variant="ghost" onClick={onRetry}>
              Try again
            </Button>
          </span>
        </>
      );

    // Every one of these is a real step that has actually started; none of them
    // is a placebo progress bar.
    case "checking-acl":
    case "resolving":
    case "awaiting-signature":
    case "decrypting":
      return (
        <span className="cvalue-busy">
          <span className="spinner" style={{ width: 10, height: 10 }} />
          {DECRYPT_STAGE_LABEL[entry.stage]}
          {entry.stage === "resolving" && entry.waitedMs ? (
            <span className="mono faint">{formatSeconds(entry.waitedMs)}</span>
          ) : null}
        </span>
      );

    default:
      return (
        <span>
          <Button size="sm" variant="ghost" onClick={onRetry}>
            <UnlockIcon size={12} />
            Decrypt
          </Button>
        </span>
      );
  }
}

function DecryptedValue({
  value,
  decimals,
  symbol,
  kind,
  handle,
}: {
  value: bigint;
  decimals: number;
  symbol: string;
  kind: ValueKind;
  handle: Handle;
}) {
  const [showSource, setShowSource] = useState(false);
  const monthly = kind === "rate" ? value * SECONDS_PER_MONTH : null;

  return (
    <>
      <span className="row" style={{ gap: 7, flexWrap: "nowrap" }}>
        <UnlockIcon size={12} style={{ color: "var(--plain)", flex: "none" }} />
        <span className="plainvalue">
          {monthly === null
            ? formatAmount(value, decimals)
            : formatAmount(monthly, decimals)}
          <span className="plainvalue-unit">
            {symbol}
            {monthly === null ? "" : " / month"}
          </span>
        </span>
      </span>
      <button
        type="button"
        className="tiny mono cvalue-note"
        onClick={() => setShowSource((v) => !v)}
        title="Where this number came from"
      >
        {showSource ? "hide source" : "decrypted from handle"}
      </button>
      {showSource && (
        <span className="stack-sm" style={{ gap: 4 }}>
          <HandleChip handle={handle} lead={10} />
          {monthly !== null && (
            <span className="tiny faint mono">
              {value.toString()} base units / second × {SECONDS_PER_MONTH.toString()} s
            </span>
          )}
          <span className="tiny faint">
            Returned by <span className="mono">handleClient.decrypt()</span> after
            your EIP-712 signature — gasless, and only because NoxCompute lists
            this account as a viewer.
          </span>
        </span>
      )}
    </>
  );
}

export function NotAuthorised() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="chip-locked"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <LockIcon size={11} />
        Not authorised
      </button>
      {open && (
        <span className="tiny faint" style={{ maxWidth: 320, display: "block" }}>
          NoxCompute's access list does not include this account for this handle,
          so no decryption was attempted and no signature was requested. That is
          the system working: the handle is public, the number is not.
        </span>
      )}
    </>
  );
}
