import { useAccount } from "wagmi";
import type { Handle } from "@shared/nox";
import { ConfidentialValue } from "./ConfidentialValue";
import { Badge, Button, EmptyState } from "./ui";
import { LockIcon, UnlockIcon } from "./icons";
import { shortAddress } from "@/nox/handle";
import { useDecryption } from "@/nox/DecryptionProvider";
import { useViewMode } from "@/state/ViewModeProvider";
import type { RosterRow } from "@/hooks/useRoster";

/**
 * The roster as the chain holds it: public addresses, encrypted rates.
 *
 * The salary column is the demo. In the public view it is the literal handle
 * returned by `ratePerSecondOf`. In the private view it is whatever a real
 * `decrypt()` returns — which, for most rows, is nothing, because most rows are
 * not yours.
 */
export function RosterTable({
  rows,
  decimals,
  symbol,
  isLoading,
}: {
  rows: readonly RosterRow[];
  decimals: number;
  symbol: string;
  isLoading?: boolean;
}) {
  const { address } = useAccount();
  const { isPrivate } = useViewMode();
  const { requestMany, entryFor } = useDecryption();

  const handles = rows
    .map((row) => row.rateHandle)
    .filter((handle): handle is Handle => Boolean(handle));
  const untried = handles.filter((handle) => entryFor(handle).stage === "idle");

  if (!isLoading && rows.length === 0) {
    return (
      <EmptyState glyph={<LockIcon size={19} />} title="No one on the roster yet">
        Encrypt a payroll roster below and submit it. Employee addresses will
        appear here in public; their salaries never will.
      </EmptyState>
    );
  }

  return (
    <div className="stack-sm">
      {isPrivate && untried.length > 0 && (
        <div className="row-between">
          <span className="tiny faint">
            {untried.length} row{untried.length === 1 ? "" : "s"} not yet attempted.
          </span>
          <Button size="sm" variant="ghost" onClick={() => void requestMany(untried)}>
            <UnlockIcon size={12} />
            Decrypt everything I am allowed to see
          </Button>
        </div>
      )}

      <div className="tablewrap">
        <table className="data">
          <thead>
            <tr>
              <th style={{ width: 42 }}>#</th>
              <th>Employee</th>
              <th>Status</th>
              <th>{isPrivate ? "Salary" : "Salary — as stored on-chain"}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const isYou = address?.toLowerCase() === row.employee.toLowerCase();
              return (
                <tr key={row.employee} className={isYou ? "is-you" : undefined}>
                  <td className="mono tiny faint">{index + 1}</td>
                  <td>
                    <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
                      <span className="mono small nowrap">
                        {shortAddress(row.employee)}
                      </span>
                      {isYou && <Badge tone="mode">you</Badge>}
                    </div>
                  </td>
                  <td>
                    {row.isActive ? (
                      <Badge tone="plain">accruing</Badge>
                    ) : (
                      <Badge tone="warn">revoked</Badge>
                    )}
                  </td>
                  <td>
                    <ConfidentialValue
                      handle={row.rateHandle}
                      decimals={decimals}
                      symbol={symbol}
                      kind="rate"
                      auto={isYou}
                    />
                  </td>
                </tr>
              );
            })}
            {isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={4} className="small faint">
                  Reading the roster from Sepolia…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!isPrivate && rows.length > 0 && (
        <p className="tiny faint">
          Those bytes are the whole of it. There is no hidden amount field an
          indexer could pick up later — the number exists only as ciphertext
          held by Nox, and only for accounts the contract granted access to.
        </p>
      )}
      {rows.some((row) => !row.isActive) && (
        <p className="tiny faint">
          A revoked employee stops accruing but stays on the roster: whatever
          they already earned is still theirs to claim.
        </p>
      )}
    </div>
  );
}
