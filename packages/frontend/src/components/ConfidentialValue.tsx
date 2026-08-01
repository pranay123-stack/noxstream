import { useEffect, useState, type ReactNode } from "react";
import { isZeroHandle, type Handle } from "@shared/nox";
import { SECONDS_PER_MONTH } from "@shared/types";
import { DECRYPT_STAGE_LABEL, useDecryption } from "@/nox/DecryptionProvider";
import { formatAmount, formatSeconds } from "@/lib/format";
import { useViewMode } from "@/state/ViewModeProvider";
import { HandleChip } from "./HandleChip";
import { Button } from "./ui";
import { LockIcon, UnlockIcon } from "./icons";

/**
 * The same on-chain value, rendered two ways.
 *
 * PUBLIC  → the handle, always, no exceptions. Flipping to public genuinely
 *           re-hides the number; there is no cached plaintext on screen.
 * PRIVATE → the result of a real `decrypt()`, and only when the connected
 *           account passed the on-chain `isViewer` check.
 *
 * Every intermediate state on the way there is a real step, labelled.
 */

export type ValueKind = "rate" | "amount";

export function ConfidentialValue({
  handle,
  decimals,
  symbol,
  kind = "amount",
  /** Start decryption automatically when the private view is entered. */
  auto = false,
  /** Rendered in the public view instead of a bare handle, if provided. */
  publicHint,
}: {
  handle: Handle | undefined;
  decimals: number;
  symbol: string;
  kind?: ValueKind;
  auto?: boolean;
  publicHint?: ReactNode;
}) {
  const { isPrivate } = useViewMode();
  const { entryFor, request } = useDecryption();
  const entry = entryFor(handle);

  useEffect(() => {
    if (!auto || !isPrivate || !handle) return;
    if (entry.stage === "idle") void request(handle);
  }, [auto, isPrivate, handle, entry.stage, request]);

  if (!isPrivate) {
    return (
      <span className="row" style={{ gap: 8, flexWrap: "nowrap", minWidth: 0 }}>
        <HandleChip handle={handle} />
        {publicHint}
      </span>
    );
  }

  if (!handle || isZeroHandle(handle)) {
    return <HandleChip handle={handle} />;
  }

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
      return (
        <span className="stack-sm" style={{ gap: 5 }}>
          <HandleChip handle={handle} dim />
          <NotAuthorised />
        </span>
      );

    case "error":
      return (
        <span className="stack-sm" style={{ gap: 5 }}>
          <HandleChip handle={handle} dim />
          <span className="tiny" style={{ color: "var(--danger)" }}>
            {entry.error?.title ?? "Decryption failed"}
          </span>
          <span>
            <Button size="sm" variant="ghost" onClick={() => void request(handle)}>
              Try again
            </Button>
          </span>
        </span>
      );

    case "checking-acl":
    case "resolving":
    case "awaiting-signature":
    case "decrypting":
      return (
        <span className="stack-sm" style={{ gap: 5 }}>
          <HandleChip handle={handle} dim />
          <span className="tiny row" style={{ gap: 6, color: "var(--mode)" }}>
            <span className="spinner" style={{ width: 10, height: 10 }} />
            {DECRYPT_STAGE_LABEL[entry.stage]}
            {entry.stage === "resolving" && entry.waitedMs ? (
              <span className="mono faint">{formatSeconds(entry.waitedMs)}</span>
            ) : null}
          </span>
        </span>
      );

    case "uninitialised":
      return <HandleChip handle={handle} />;

    default:
      return (
        <span className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
          <HandleChip handle={handle} dim />
          <Button size="sm" variant="ghost" onClick={() => void request(handle)}>
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
    <span className="stack-sm" style={{ gap: 4, minWidth: 0 }}>
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
        className="tiny faint mono"
        style={{
          background: "none",
          border: 0,
          padding: 0,
          cursor: "pointer",
          textAlign: "left",
        }}
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
    </span>
  );
}

export function NotAuthorised() {
  const [open, setOpen] = useState(false);
  return (
    <span className="stack-sm" style={{ gap: 4 }}>
      <button
        type="button"
        className="badge"
        style={{ cursor: "pointer" }}
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
    </span>
  );
}
