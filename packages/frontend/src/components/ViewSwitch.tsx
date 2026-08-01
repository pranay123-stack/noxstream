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

export function ViewSwitchExplainer() {
  const { isPrivate } = useViewMode();
  return (
    <p className="small muted" style={{ maxWidth: 640 }}>
      {isPrivate ? (
        <>
          <strong style={{ color: "var(--plain)" }}>Private view.</strong> The same
          rows, decrypted through Nox. A value only appears where the connected
          account holds an on-chain ACL grant and has signed for it — every other
          row stays ciphertext, including for the person reading this screen.
        </>
      ) : (
        <>
          <strong style={{ color: "var(--cipher)" }}>Public view.</strong> This is
          literally what any observer of Sepolia can read: the roster addresses,
          the aggregate stream, and a 32-byte handle where each salary should be.
          No amount is hidden behind a UI flag — there is no amount on-chain to
          hide.
        </>
      )}
    </p>
  );
}
