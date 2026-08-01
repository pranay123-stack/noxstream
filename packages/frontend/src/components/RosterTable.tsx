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
        Nobody has been given an allocation. Add employees below and submit them:
        their addresses will appear here in public, their salaries never will.
      </EmptyState>
    );
  }

  return (
    <div className="stack-sm">
      {untried.length > 0 &&
        (address ? (
          <div className="row-between">
            <span className="tiny faint">
              {untried.length} row{untried.length === 1 ? "" : "s"} not yet
              attempted. Nothing is decrypted until you ask for it.
            </span>
            <Button size="sm" variant="ghost" onClick={() => void requestMany(untried)}>
              <UnlockIcon size={12} />
              Decrypt everything I am allowed to see
            </Button>
          </div>
        ) : (
          <span className="tiny faint">
            This is the roster as an anonymous observer sees it. Connect a wallet
            and any row you have been granted access to turns into a number.
          </span>
        ))}

      <div className="tablewrap">
        <table className="data">
          <thead>
            <tr>
              <th style={{ width: 42 }}>#</th>
              <th>Employee</th>
              <th>Status</th>
              <th>
                Salary (hidden on-chain)
                <span className="th-term mono">
                  euint256 handle → what this account can read
                </span>
              </th>
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
                      <Badge tone="plain">earning</Badge>
                    ) : (
                      <Badge tone="warn">stopped</Badge>
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
          The left-hand bytes are the whole of it — there is no amount field an
          indexer could pick up later. A row turns into a number only when this
          account was given permission to read that one salary, which is why
          most rows stay locked.{" "}
          <span className="mono">
            NoxCompute.isViewer(handle, you) is read on-chain before anything
            else happens.
          </span>
        </p>
      )}
      {rows.some((row) => !row.isActive) && (
        <p className="tiny faint">
          A stopped employee earns nothing further but stays on the roster:
          whatever they already earned is still theirs to claim.
        </p>
      )}
    </div>
  );
}
