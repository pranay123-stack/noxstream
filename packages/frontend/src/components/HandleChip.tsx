import { useState } from "react";
import { isZeroHandle, type Handle } from "@shared/nox";
import { decodeHandle, shortHandle } from "@/nox/handle";
import { CopyButton } from "./ui";
import { LockIcon } from "./icons";

/**
 * Renders a real `euint256` handle, exactly as it was read from the chain.
 *
 * Nothing here is decoration: the truncated text is the true first bytes, the
 * expanded view is the full 32 bytes, and the metadata line is parsed out of
 * those bytes (version / chain / type / origin are public by design — the
 * *value* is what is not). Click to expand.
 */
export function HandleChip({
  handle,
  dim,
  lead = 6,
}: {
  handle: Handle | undefined;
  dim?: boolean;
  lead?: number;
}) {
  const [open, setOpen] = useState(false);

  if (!handle) {
    return <span className="faint mono small">—</span>;
  }

  if (isZeroHandle(handle)) {
    return (
      <span
        className="cipher cipher-zero"
        title="Nothing has been written here yet — the stored pointer is all zeroes"
      >
        <LockIcon size={12} className="cipher-lock" />
        <span className="cipher-text">not set</span>
      </span>
    );
  }

  const meta = decodeHandle(handle);

  return (
    <span className="stack-sm" style={{ gap: 6, display: "inline-flex", minWidth: 0 }}>
      <span className="row" style={{ gap: 4, flexWrap: "nowrap", minWidth: 0 }}>
        <button
          type="button"
          className="cipher"
          style={dim ? { opacity: 0.55 } : undefined}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          title={open ? "Hide the full handle" : "Show all 32 bytes"}
        >
          <LockIcon size={12} className="cipher-lock" />
          <span className="cipher-text">{shortHandle(handle, lead)}</span>
        </button>
        <CopyButton value={handle} label="Copy handle" />
      </span>

      {open && (
        <span className="stack-sm" style={{ gap: 5 }}>
          <code className="cipher-full">{handle}</code>
          {meta && (
            <span className="tiny faint mono">
              v{meta.version} · chain {meta.chainId} · {meta.solidityType ?? "unknown type"} ·{" "}
              {meta.isFreshInput ? "encrypted input" : "computed in TEE"}
            </span>
          )}
          <span className="tiny faint">
            Anyone can read these bytes off the chain. Nobody can read the number
            behind them without being granted access to it first.
            <span className="mono"> Public structure, private value.</span>
          </span>
        </span>
      )}
    </span>
  );
}
