import { isZeroHandle } from "@shared/nox";
import { HandleChip } from "@/components/HandleChip";
import { ArrowRightIcon, UnlockIcon } from "@/components/icons";
import { useRoster } from "@/hooks/useRoster";

/**
 * The whole product in three lines, for someone who has never heard of Nox.
 *
 * It ends on a REAL handle read from `NoxPayrollRegistry.ratePerSecondOf` on
 * Sepolia — not a sample. If the roster is empty there is nothing honest to
 * show, so that footer does not render at all; inventing a handle here would
 * undercut the one claim the app is making.
 */

const STEPS = [
  {
    title: "One public stream funds the whole company",
    body: "An ordinary Sablier stream, unmodified. Anyone can audit the total.",
    term: "Sablier Lockup Linear",
  },
  {
    title: "Each salary is encrypted inside a secure enclave",
    body: "The chain stores a pointer to the number, never the number itself.",
    term: "iExec Nox TEE · euint256",
  },
  {
    title: "Each employee claims privately",
    body: "The amount never appears — not even in the transaction's event log.",
    term: "ERC-7984 confidential transfer",
  },
] as const;

export function HowItWorks() {
  return (
    <section className="howto" aria-label="How NoxStream works">
      <ol className="howto-steps">
        {STEPS.map((step, index) => (
          <li key={step.title} className="howto-step">
            <span className="howto-num" aria-hidden="true">
              {index + 1}
            </span>
            <span className="howto-copy">
              <strong>{step.title}</strong>
              <span className="small muted">{step.body}</span>
              <span className="tiny faint mono">{step.term}</span>
            </span>
          </li>
        ))}
      </ol>
      <LiveProof />
    </section>
  );
}

function LiveProof() {
  const roster = useRoster();
  const sample = roster.rows.find(
    (row) => row.rateHandle && !isZeroHandle(row.rateHandle),
  );
  if (!sample?.rateHandle) return null;

  return (
    <div className="howto-proof">
      <span className="eyebrow">
        Live from Sepolia — one real salary, exactly as the chain stores it
      </span>
      <div className="howto-proof-row">
        <HandleChip handle={sample.rateHandle} />
        <ArrowRightIcon size={14} className="cvalue-arrow" />
        <span className="howto-proof-out">
          <UnlockIcon size={12} />a real number — but only for an account this
          salary was shared with
        </span>
      </div>
      <p className="tiny faint" style={{ maxWidth: "78ch" }}>
        Those bytes are a <strong>handle</strong>: a 32-byte pointer to data
        encrypted inside a secure enclave. Reading it from the chain reveals
        nothing without permission. Read live from{" "}
        <span className="mono">ratePerSecondOf()</span>.
      </p>
    </div>
  );
}
