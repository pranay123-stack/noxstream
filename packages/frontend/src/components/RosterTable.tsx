import { useAccount } from "wagmi";
import type { Handle } from "@shared/nox";
import { ConfidentialValue } from "./ConfidentialValue";
import { Badge, Button, EmptyState } from "./ui";
import { LockIcon, UnlockIcon } from "./icons";
import { shortAddress } from "@/nox/handle";
import { useDecryption } from "@/nox/DecryptionProvider";
import type { RosterRow } from "@/hooks/useRoster";

/**
 * The roster as the chain holds it: public addresses, encrypted rates.
 *
 * The salary column is the demo, and it carries both halves at once — the
 * literal handle returned by `ratePerSecondOf`, then whatever a real
 * `decrypt()` returns for the connected account. For most rows that is nothing,
 * because most rows are not yours, and the two kinds of row sitting next to
 * each other is the proof.
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
      {untried.length > 0 && (
        <div className="row-between">
          <span className="tiny faint">
            {untried.length} row{untried.length === 1 ? "" : "s"} not yet attempted.
            Nothing is decrypted until you ask for it.
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
              <th>Salary — stored ciphertext → what you can read</th>
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
                      {isYou && <Badge tone="accent">you</Badge>}
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

      {rows.length > 0 && (
        <p className="tiny faint">
          The left-hand bytes are the whole of it. There is no hidden amount
          field an indexer could pick up later — a row only turns into a number
          when NoxCompute's access list names this account, which is why most
          of them do not.
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
