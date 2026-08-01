import { useViewMode } from "@/state/ViewModeProvider";
import { EyeIcon, UnlockIcon } from "./icons";

/**
 * The headline control. Two renderings of the same on-chain state:
 * what everyone sees, and what only you can see.
 */
export function ViewSwitch() {
  const { mode, setMode } = useViewMode();
  return (
    <div className="viewswitch" data-mode={mode} role="group" aria-label="Data view">
      <span className="viewswitch-thumb" aria-hidden="true" />
      <button
        type="button"
        className="viewswitch-option"
        aria-pressed={mode === "public"}
        onClick={() => setMode("public")}
      >
        <EyeIcon size={14} />
        Public view
      </button>
      <button
        type="button"
        className="viewswitch-option"
        aria-pressed={mode === "private"}
        onClick={() => setMode("private")}
      >
        <UnlockIcon size={14} />
        Private view
      </button>
    </div>
  );
}

/**
 * Caption for whichever rendering is on screen. Deliberately terse — it labels
 * the data below it, and a paragraph here would compete with the data itself.
 */
export function ViewSwitchExplainer() {
  const { isPrivate } = useViewMode();
  return (
    <p className="mode-note muted">
      {isPrivate ? (
        <span>
          <strong style={{ color: "var(--plain)" }}>Private view.</strong> The same
          rows, decrypted through Nox. A number appears only where the connected
          account holds an on-chain ACL grant and has signed for it. Every other
          row stays ciphertext — including for you.
        </span>
      ) : (
        <span>
          <strong style={{ color: "var(--cipher)" }}>Public view.</strong> Exactly
          what any observer of Sepolia can read: roster addresses, the aggregate
          stream, and a 32-byte handle where each salary should be. Nothing is
          hidden behind a UI flag — there is no amount on-chain to hide.
        </span>
      )}
    </p>
  );
}
