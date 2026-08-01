import type { useTxFlow } from "@/hooks/useTxFlow";
import { Callout, ExplorerLink } from "./ui";

/** Real transaction state — signing, mined, or the reason it failed. */
export function TxNote({
  flow,
  label,
}: {
  flow: ReturnType<typeof useTxFlow>;
  label: string;
}) {
  if (flow.stage === "idle") return null;
  if (flow.error) {
    return (
      <Callout tone={flow.error.expected ? "warn" : "danger"} title={flow.error.title}>
        {flow.error.detail}
      </Callout>
    );
  }
  if (flow.stage === "confirmed" && flow.hash) {
    return (
      <Callout tone="ok" title={`${label} confirmed`}>
        <ExplorerLink hash={flow.hash} />
      </Callout>
    );
  }
  return (
    <p className="small muted row" style={{ gap: 8 }}>
      <span className="spinner" />
      {flow.stage === "awaiting-signature"
        ? `${label}: confirm in your wallet…`
        : `${label}: waiting for the block…`}
    </p>
  );
}
