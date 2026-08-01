import { useMemo, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { addresses } from "@/config/deployments";
import { CSV_PLACEHOLDER, parseRosterCsv } from "@/lib/csv";
import { formatAmount } from "@/lib/format";
import {
  newDraftRow,
  roundingShortfall,
  totalMonthly,
  totalRatePerSecond,
  validateRoster,
  type DraftRow,
} from "@/lib/roster";
import { payrollRegistryAbi } from "@/contracts/abis";
import { useAllocationEncryption } from "@/hooks/useAllocationEncryption";
import { useTxFlow } from "@/hooks/useTxFlow";
import { shortAddress } from "@/nox/handle";
import { HandleChip } from "@/components/HandleChip";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  CardHead,
  ExplorerLink,
  Field,
  IconButton,
  Input,
  KeyValue,
  Steps,
  TextArea,
  Tile,
  type StepState,
} from "@/components/ui";
import { LockIcon, PlusIcon, TrashIcon, UploadIcon } from "@/components/icons";

/**
 * Employer flow: roster → ciphertext → one batched transaction.
 *
 * The middle step is shown, not hidden behind a spinner: each salary visibly
 * becomes a 32-byte handle before anything is sent. That is the only moment in
 * the app where a real number and its ciphertext are on screen together, and
 * it is the moment the product explains itself.
 */
export function AllocationComposer({
  decimals,
  symbol,
  isEmployer,
  onSubmitted,
}: {
  decimals: number;
  symbol: string;
  isEmployer: boolean;
  onSubmitted: () => void;
}) {
  const { address } = useAccount();
  const registry = addresses?.payrollRegistry;
  const [mode, setMode] = useState<"manual" | "csv">("manual");
  const [draft, setDraft] = useState<DraftRow[]>([newDraftRow(), newDraftRow()]);
  const [csv, setCsv] = useState("");
  const [csvSkipped, setCsvSkipped] = useState<
    Array<{ line: number; text: string; reason: string }>
  >([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const encryption = useAllocationEncryption();
  const tx = useTxFlow();

  const { rows: valid, issues } = useMemo(
    () => validateRoster(draft, decimals),
    [draft, decimals],
  );
  const issueFor = (id: string, field: "employee" | "monthly") =>
    issues.find((issue) => issue.id === id && issue.field === field)?.message;

  const monthlyTotal = totalMonthly(valid);
  const perSecondTotal = totalRatePerSecond(valid);
  const shortfall = valid.reduce(
    (sum, row) => sum + roundingShortfall(row.monthlyAmount),
    0n,
  );

  const canEncrypt = valid.length > 0 && issues.length === 0 && Boolean(registry);
  const stage: "compose" | "encrypted" =
    encryption.rows.length > 0 ? "encrypted" : "compose";

  function applyCsv(text: string) {
    const parsed = parseRosterCsv(text);
    setCsvSkipped(parsed.skipped);
    if (parsed.rows.length > 0) {
      setDraft(parsed.rows);
      setMode("manual");
    }
  }

  async function submit() {
    if (!registry) return;
    const ready = encryption.rows.filter((row) => row.handle && row.proof);
    if (ready.length === 0) return;
    const receipt = await tx.send({
      address: registry,
      abi: payrollRegistryAbi,
      functionName: "setAllocations",
      args: [
        ready.map((row) => row.employee),
        ready.map((row) => row.handle!),
        ready.map((row) => row.proof!),
      ],
    });
    if (receipt) onSubmitted();
  }

  const steps: Array<{ label: string; state: StepState; detail?: string }> = [
    {
      label: "Compose the roster",
      state: stage === "compose" ? "active" : "done",
      detail: `${valid.length} row${valid.length === 1 ? "" : "s"}`,
    },
    {
      label: "Encrypt each salary into a handle",
      state: encryption.isRunning
        ? "active"
        : encryption.isComplete
          ? "done"
          : encryption.failedCount > 0
            ? "failed"
            : "pending",
      detail: encryption.rows.length
        ? `${encryption.rows.filter((r) => r.status === "done").length}/${encryption.rows.length}`
        : undefined,
    },
    {
      label: "Submit one batched transaction",
      state:
        tx.stage === "confirmed"
          ? "done"
          : tx.stage === "error"
            ? "failed"
            : tx.isBusy
              ? "active"
              : "pending",
      detail:
        tx.stage === "awaiting-signature"
          ? "signing"
          : tx.stage === "pending"
            ? "mining"
            : undefined,
    },
  ];

  return (
    <Card>
      <CardHead
        title="Encrypt and submit allocations"
        sub="Salaries are encrypted in your browser. The registry only ever sees handles."
        action={
          <div className="tabs" role="tablist">
            <button
              className="tab"
              role="tab"
              aria-selected={mode === "manual"}
              onClick={() => setMode("manual")}
            >
              Rows
            </button>
            <button
              className="tab"
              role="tab"
              aria-selected={mode === "csv"}
              onClick={() => setMode("csv")}
            >
              Paste CSV
            </button>
          </div>
        }
      />

      <CardBody className="stack">
        {!isEmployer && address && (
          <Callout tone="warn" title="This account is not the employer">
            You can encrypt a roster to see how it works, but{" "}
            <span className="mono">setAllocations</span> is employer-only and will
            revert with <span className="mono">NotEmployer</span>. Switch to the
            deploying account to submit.
          </Callout>
        )}

        {mode === "csv" ? (
          <div className="stack-sm">
            <Field
              label="Roster CSV"
              hint="address, name (optional), monthly salary — one employee per line. Names stay in your browser."
            >
              <TextArea
                value={csv}
                placeholder={CSV_PLACEHOLDER}
                onChange={(event) => setCsv(event.target.value)}
              />
            </Field>
            <div className="row">
              <Button variant="primary" onClick={() => applyCsv(csv)} disabled={!csv.trim()}>
                Load {csv.trim() ? `${csv.trim().split(/\r?\n/).length} lines` : "roster"}
              </Button>
              <Button variant="ghost" onClick={() => fileInput.current?.click()}>
                <UploadIcon size={13} />
                Upload .csv
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept=".csv,text/csv,text/plain"
                className="sr-only"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  const text = await file.text();
                  setCsv(text);
                  applyCsv(text);
                  event.target.value = "";
                }}
              />
            </div>
            {csvSkipped.length > 0 && (
              <Callout tone="warn" title={`${csvSkipped.length} line(s) skipped`}>
                <ul className="tiny mono" style={{ margin: 0, paddingLeft: 18 }}>
                  {csvSkipped.slice(0, 6).map((skip) => (
                    <li key={skip.line}>
                      line {skip.line}: {skip.reason} — “{skip.text.slice(0, 48)}”
                    </li>
                  ))}
                </ul>
              </Callout>
            )}
          </div>
        ) : (
          <div className="stack-sm">
            <div className="tablewrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Employee address</th>
                    <th style={{ width: "22%" }}>Name (local only)</th>
                    <th style={{ width: "22%" }}>Monthly {symbol}</th>
                    <th style={{ width: 44 }} />
                  </tr>
                </thead>
                <tbody>
                  {draft.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <Input
                          value={row.employee}
                          placeholder="0x…"
                          className="mono"
                          invalid={Boolean(issueFor(row.id, "employee"))}
                          onChange={(event) =>
                            setDraft((rows) =>
                              rows.map((r) =>
                                r.id === row.id
                                  ? { ...r, employee: event.target.value }
                                  : r,
                              ),
                            )
                          }
                        />
                        {issueFor(row.id, "employee") && (
                          <span className="field-error tiny">
                            {issueFor(row.id, "employee")}
                          </span>
                        )}
                      </td>
                      <td>
                        <Input
                          value={row.label}
                          placeholder="optional"
                          onChange={(event) =>
                            setDraft((rows) =>
                              rows.map((r) =>
                                r.id === row.id ? { ...r, label: event.target.value } : r,
                              ),
                            )
                          }
                        />
                      </td>
                      <td>
                        <Input
                          value={row.monthly}
                          placeholder="5000"
                          inputMode="decimal"
                          className="mono"
                          invalid={Boolean(issueFor(row.id, "monthly"))}
                          onChange={(event) =>
                            setDraft((rows) =>
                              rows.map((r) =>
                                r.id === row.id
                                  ? { ...r, monthly: event.target.value }
                                  : r,
                              ),
                            )
                          }
                        />
                        {issueFor(row.id, "monthly") && (
                          <span className="field-error tiny">
                            {issueFor(row.id, "monthly")}
                          </span>
                        )}
                      </td>
                      <td>
                        <IconButton
                          label="Remove row"
                          onClick={() =>
                            setDraft((rows) =>
                              rows.length === 1
                                ? [newDraftRow()]
                                : rows.filter((r) => r.id !== row.id),
                            )
                          }
                        >
                          <TrashIcon size={13} />
                        </IconButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDraft((rows) => [...rows, newDraftRow()])}
              >
                <PlusIcon size={12} />
                Add employee
              </Button>
            </div>
          </div>
        )}

        {valid.length > 0 && (
          <div className="grid-3">
            <Tile label="Headcount" value={valid.length} />
            <Tile
              label={`Monthly total`}
              value={`${formatAmount(monthlyTotal, decimals)} ${symbol}`}
              note="Public — this is what the aggregate stream must cover"
            />
            <Tile
              label="Aggregate rate"
              value={`${formatAmount(perSecondTotal * 86_400n, decimals)} / day`}
              note={
                shortfall > 0n
                  ? `Rounding down costs ${formatAmount(shortfall, decimals, 4)} ${symbol}/month across the roster`
                  : undefined
              }
            />
          </div>
        )}

        <Steps steps={steps} />

        <div className="row">
          <Button
            variant="accent"
            disabled={!canEncrypt}
            loading={encryption.isRunning}
            onClick={() => {
              tx.reset();
              if (registry) void encryption.encrypt(valid, registry);
            }}
          >
            <LockIcon size={13} />
            {encryption.rows.length > 0
              ? "Re-encrypt"
              : valid.length === 0
                ? "Encrypt allocations"
                : `Encrypt ${valid.length} allocation${valid.length === 1 ? "" : "s"}`}
          </Button>
          {encryption.rows.length > 0 && (
            <Button
              variant="ghost"
              onClick={() => {
                encryption.clear();
                tx.reset();
              }}
            >
              Discard handles
            </Button>
          )}
        </div>

        {encryption.rows.length > 0 && (
          <EncryptionReveal
            rows={encryption.rows}
            decimals={decimals}
            symbol={symbol}
          />
        )}

        {encryption.isComplete && (
          <div className="stack-sm">
            <Callout tone="ok" title="Every salary is now a handle">
              The plaintext never leaves this browser. Each handle is bound to the
              registry at{" "}
              <span className="mono tiny">{shortAddress(registry ?? "0x")}</span> —
              it cannot be replayed against another contract.
            </Callout>
            <div className="row">
              <Button
                variant="primary"
                onClick={() => void submit()}
                loading={tx.isBusy}
                disabled={!registry}
              >
                Submit {encryption.rows.length} allocation
                {encryption.rows.length === 1 ? "" : "s"} in one transaction
              </Button>
              {tx.stage === "awaiting-signature" && (
                <span className="small muted">Confirm in your wallet…</span>
              )}
              {tx.stage === "pending" && (
                <span className="small muted">Waiting for the block…</span>
              )}
            </div>
          </div>
        )}

        {tx.error && (
          <Callout tone={tx.error.expected ? "warn" : "danger"} title={tx.error.title}>
            {tx.error.detail}
          </Callout>
        )}

        {tx.stage === "confirmed" && tx.hash && (
          <Callout tone="ok" title="Roster submitted">
            <div className="stack-sm">
              <span>
                One transaction, {encryption.rows.length} salaries, zero amounts on
                the wire.
              </span>
              <ExplorerLink hash={tx.hash} />
            </div>
          </Callout>
        )}
      </CardBody>
    </Card>
  );
}

function EncryptionReveal({
  rows,
  decimals,
  symbol,
}: {
  rows: ReturnType<typeof useAllocationEncryption>["rows"];
  decimals: number;
  symbol: string;
}) {
  return (
    <div className="stack-sm">
      <span className="eyebrow">Plaintext in, ciphertext out</span>
      <div className="tablewrap">
        <table className="data">
          <thead>
            <tr>
              <th>Employee</th>
              <th style={{ width: "26%" }}>What you typed</th>
              <th>What the chain will store</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="animate-in">
                <td>
                  <div className="stack-sm" style={{ gap: 1 }}>
                    <span className="mono small">{shortAddress(row.employee)}</span>
                    {row.label && <span className="tiny faint">{row.label}</span>}
                  </div>
                </td>
                <td>
                  <span className="mono small" style={{ color: "var(--warn)" }}>
                    {formatAmount(row.monthlyAmount, decimals)} {symbol}
                  </span>
                  <div className="tiny faint mono">
                    {row.ratePerSecond.toString()} /s
                  </div>
                </td>
                <td>
                  {row.status === "done" && row.handle ? (
                    <div className="stack-sm" style={{ gap: 3 }}>
                      <HandleChip handle={row.handle} lead={8} />
                      {row.elapsedMs && (
                        <span className="tiny faint mono">
                          minted in {Math.round(row.elapsedMs)}ms
                        </span>
                      )}
                    </div>
                  ) : row.status === "encrypting" ? (
                    <span className="row tiny" style={{ gap: 7, color: "var(--cipher)" }}>
                      <span className="spinner" style={{ width: 11, height: 11 }} />
                      encrypting at the handle gateway…
                    </span>
                  ) : row.status === "error" ? (
                    <div className="stack-sm" style={{ gap: 2 }}>
                      <Badge tone="danger">failed</Badge>
                      <span className="tiny faint">{row.error?.title}</span>
                    </div>
                  ) : (
                    <span className="tiny faint">queued</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <KeyValue
        k="Total plaintext bytes sent on-chain"
        v="0 — only handles and their proofs"
      />
    </div>
  );
}
