import { useEffect, useMemo, useState } from "react";
import { parseEventLogs, type Log } from "viem";
import { useAccount, useReadContracts } from "wagmi";
import type { Handle } from "@shared/nox";
import { SECONDS_PER_MONTH } from "@shared/types";
import { addresses } from "@/config/deployments";
import {
  erc7984Abi,
  payrollRegistryAbi,
  streamPayrollAbi,
} from "@/contracts/abis";
import { ConfidentialValue } from "@/components/ConfidentialValue";
import { HandleChip } from "@/components/HandleChip";
import { HarvestControls } from "@/components/HarvestControls";
import { TxNote } from "@/components/TxNote";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  CardHead,
  EmptyState,
  ExplorerLink,
  KeyValue,
  Tile,
} from "@/components/ui";
import { LockIcon, RefreshIcon, UnlockIcon } from "@/components/icons";
import { formatAmount, formatDuration, formatTimestamp } from "@/lib/format";
import { ZERO_ADDRESS, type ProtocolInfo } from "@/hooks/useProtocol";
import { useRoster } from "@/hooks/useRoster";
import { useTxFlow } from "@/hooks/useTxFlow";
import { useDecryption } from "@/nox/DecryptionProvider";
import { shortAddress } from "@/nox/handle";

/**
 * The employee side. Three numbers that exist on-chain only as ciphertext, one
 * transaction that moves money without naming an amount.
 */
export function EmployeeView({ protocol }: { protocol: ProtocolInfo }) {
  const { address } = useAccount();
  const { entryFor } = useDecryption();
  const claimTx = useTxFlow();
  const settleTx = useTxFlow();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  const registry = addresses?.payrollRegistry ?? ZERO_ADDRESS;
  const payroll = addresses?.noxStreamPayroll ?? ZERO_ADDRESS;
  const token = protocol.confidentialToken ?? ZERO_ADDRESS;
  const me = address ?? ZERO_ADDRESS;
  const enabled = Boolean(address) && addresses !== null;

  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  const reads = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: registry, abi: payrollRegistryAbi, functionName: "isRegistered", args: [me] },
      { address: registry, abi: payrollRegistryAbi, functionName: "isActive", args: [me] },
      { address: registry, abi: payrollRegistryAbi, functionName: "ratePerSecondOf", args: [me] },
      { address: payroll, abi: streamPayrollAbi, functionName: "confidentialAccruedOf", args: [me] },
      { address: payroll, abi: streamPayrollAbi, functionName: "confidentialClaimedOf", args: [me] },
      { address: payroll, abi: streamPayrollAbi, functionName: "lastAccrualAt", args: [me] },
      { address: token, abi: erc7984Abi, functionName: "confidentialBalanceOf", args: [me] },
    ],
    query: { enabled, refetchInterval: 15_000 },
  });

  const data = reads.data;
  const at = <T,>(index: number): T | undefined => {
    const item = data?.[index];
    return item && item.status === "success" ? (item.result as T) : undefined;
  };

  const isRegistered = at<boolean>(0) ?? false;
  const isActive = at<boolean>(1) ?? false;
  const rateHandle = at<Handle>(2);
  const accruedHandle = at<Handle>(3);
  const claimedHandle = at<Handle>(4);
  const lastAccrualAt = at<bigint>(5) ?? 0n;
  const balanceHandle = at<Handle>(6);

  const decimals = protocol.assetDecimals;
  const symbol = protocol.assetSymbol;

  const accrued = entryFor(accruedHandle);
  const claimed = entryFor(claimedHandle);
  const rate = entryFor(rateHandle);

  const claimable = useMemo(() => {
    if (accrued.stage !== "done" || claimed.stage !== "done") return undefined;
    const value = (accrued.value ?? 0n) - (claimed.value ?? 0n);
    return value > 0n ? value : 0n;
  }, [accrued.stage, accrued.value, claimed.stage, claimed.value]);

  /**
   * Projection, not a chain read: on-chain `accrued` only moves when someone
   * calls settle()/claim(). This adds rate x (now - lastAccrualAt) locally, from
   * two values that were themselves decrypted or read from chain. Labelled as a
   * projection wherever it appears.
   */
  const projected = useMemo(() => {
    if (accrued.stage !== "done" || rate.stage !== "done") return undefined;
    if (!protocol.hasStarted || !isActive) return undefined;
    const since = lastAccrualAt > 0n ? lastAccrualAt : protocol.startedAt;
    const elapsed = BigInt(now) - since;
    if (elapsed <= 0n) return accrued.value ?? 0n;
    return (accrued.value ?? 0n) + (rate.value ?? 0n) * elapsed;
  }, [
    accrued.stage,
    accrued.value,
    rate.stage,
    rate.value,
    lastAccrualAt,
    protocol.hasStarted,
    protocol.startedAt,
    isActive,
    now,
  ]);

  /** `VaultUnfunded` is a public revert, so we can name it precisely. */
  const vaultUnfunded = Boolean(claimTx.error?.raw.includes("VaultUnfunded"));

  const claimLogs = useMemo(() => {
    if (!claimTx.receipt) return [];
    try {
      return parseEventLogs({
        abi: streamPayrollAbi,
        eventName: "ConfidentialClaim",
        logs: claimTx.receipt.logs,
      });
    } catch {
      return [];
    }
  }, [claimTx.receipt]);

  // No wallet is not an empty state here — it is the observer's view, and the
  // observer's view is the demonstration. Show the real public record rather
  // than a card that only asks for a connection.
  if (!address) {
    return <PublicPayRecord protocol={protocol} />;
  }

  if (reads.isSuccess && !isRegistered) {
    return (
      <div className="stack-lg">
        <Card>
          <CardBody className="stack">
            <EmptyState
              glyph={<LockIcon size={19} />}
              title="This account is not on the roster"
            >
              <span className="mono">{address}</span> has no salary in the payroll
              registry, so nothing accrues to it. Who is on the roster is public
              by design — that part was never a secret.
            </EmptyState>
          </CardBody>
        </Card>
        <PublicPayRecord protocol={protocol} />
      </div>
    );
  }

  return (
    <div className="stack-lg">
      <Card accent>
        <CardHead
          title="Your pay — readable by you, by nobody else"
          sub="Every figure here is stored on-chain as an encrypted pointer. Each one turns into a number for this account and no other — a real decryption, not a display trick."
          action={
            <div className="row" style={{ gap: 8 }}>
              {isActive ? (
                <Badge tone="plain">earning</Badge>
              ) : (
                <Badge tone="warn">
                  no longer earning — what you already earned is still yours
                </Badge>
              )}
              <Button size="sm" variant="ghost" onClick={() => reads.refetch()}>
                <RefreshIcon size={12} />
                Refresh
              </Button>
            </div>
          }
        />
        <CardBody className="stack">
          {!protocol.hasStarted && (
            <Callout tone="warn" title="Payroll has not started yet">
              Your salary is on file, but the clock has not been switched on, so
              nothing is accumulating and a claim would be rejected. Nothing is
              lost — the employer has simply not run the one-time{" "}
              <span className="mono">start()</span> yet.
            </Callout>
          )}

          <div className="grid-3">
            <Tile
              label="Earned so far"
              term="confidentialAccruedOf — euint256 handle"
              badge={<CipherMark />}
              value={
                <ConfidentialValue
                  handle={accruedHandle}
                  decimals={decimals}
                  symbol={symbol}
                  auto
                />
              }
              note={
                projected !== undefined
                  ? `≈ ${formatAmount(projected, decimals, 4)} ${symbol} once you count the ${formatDuration(
                      now - Number(lastAccrualAt > 0n ? lastAccrualAt : protocol.startedAt),
                    )} since your balance was last written on-chain — that estimate is worked out in this browser, not read from the chain`
                  : "Last written on-chain at your last claim or balance update"
              }
            />
            <Tile
              label="Already paid out to you"
              term="confidentialClaimedOf — euint256 handle"
              badge={<CipherMark />}
              value={
                <ConfidentialValue
                  handle={claimedHandle}
                  decimals={decimals}
                  symbol={symbol}
                  auto
                />
              }
              note="This number has never appeared in any transaction or event"
            />
            <Tile
              label="Ready to claim"
              term="earned − already paid"
              value={
                claimable === undefined ? (
                  <span className="small faint">
                    Decrypt the two figures on the left and this fills itself in
                  </span>
                ) : (
                  <span className="plainvalue">
                    {formatAmount(claimable, decimals)}
                    <span className="plainvalue-unit">{symbol}</span>
                  </span>
                )
              }
              note="Nothing on-chain stores this — your browser subtracts the two decrypted values"
            />
          </div>

          <div className="grid-2">
            <div className="tile">
              <span className="tile-label">
                Your salary (hidden on-chain) <CipherMark />
              </span>
              <span className="tile-term mono">
                registry.ratePerSecondOf — euint256 handle
              </span>
              <ConfidentialValue
                handle={rateHandle}
                decimals={decimals}
                symbol={symbol}
                kind="rate"
                auto
              />
              {rate.stage === "done" && (
                <span className="tile-note mono">
                  {rate.value?.toString()} base units/second ×{" "}
                  {SECONDS_PER_MONTH.toString()} s/month
                </span>
              )}
            </div>
            <div className="tile">
              <span className="tile-label">
                Your private wallet balance <CipherMark />
              </span>
              <span className="tile-term mono">
                {protocol.confidentialSymbol ?? `c${symbol}`} — ERC-7984
                confidential token
              </span>
              <ConfidentialValue
                handle={balanceHandle}
                decimals={decimals}
                symbol={protocol.confidentialSymbol ?? `c${symbol}`}
              />
              <span className="tile-note">
                Even the total in your wallet is encrypted. It becomes a public
                number only if you choose to convert it back to ordinary{" "}
                {symbol}.
              </span>
            </div>
          </div>

          <div className="row">
            <Button
              variant="accent"
              loading={claimTx.isBusy}
              disabled={!protocol.hasStarted}
              onClick={() =>
                void claimTx
                  .send({
                    address: payroll,
                    abi: streamPayrollAbi,
                    functionName: "claim",
                  })
                  .then(() => reads.refetch())
              }
            >
              <UnlockIcon size={13} />
              Claim privately
            </Button>
            <Button
              variant="ghost"
              loading={settleTx.isBusy}
              disabled={!protocol.hasStarted}
              onClick={() =>
                void settleTx
                  .send({
                    address: payroll,
                    abi: streamPayrollAbi,
                    functionName: "settle",
                    args: [address],
                  })
                  .then(() => reads.refetch())
              }
            >
              Update my balance on-chain
            </Button>
            <span className="tiny faint">
              Asking for more than you are owed never fails loudly — it quietly
              pays the correct amount, because a failed transaction would tell
              onlookers what you are worth.{" "}
              <span className="mono">claim() clamps instead of reverting.</span>
            </span>
          </div>

          {vaultUnfunded && (
            <Callout tone="warn" title="The vault has nothing to pay you from yet">
              <div className="stack-sm">
                <span>
                  Money has unlocked in the public stream, but nobody has moved it
                  into the private vault yet. Anyone may do that, including you —
                  you are not waiting on the employer.{" "}
                  <span className="mono">harvest() is permissionless.</span>
                </span>
                <HarvestControls
                  protocol={protocol}
                  compact
                  onDone={() => claimTx.reset()}
                />
              </div>
            </Callout>
          )}

          <TxNote flow={settleTx} label="Settle" />
          {claimTx.error && !vaultUnfunded && (
            <Callout
              tone={claimTx.error.expected ? "warn" : "danger"}
              title={claimTx.error.title}
            >
              {claimTx.error.detail}
            </Callout>
          )}
          {claimTx.isBusy && (
            <p className="small muted row" style={{ gap: 8 }}>
              <span className="spinner" />
              {claimTx.stage === "awaiting-signature"
                ? "Confirm the claim in your wallet…"
                : "Claim is in the mempool…"}
            </p>
          )}
        </CardBody>
      </Card>

      {claimTx.stage === "confirmed" && claimTx.hash && (
        <ClaimProof
          hash={claimTx.hash}
          logs={claimLogs}
          rawLogs={claimTx.receipt?.logs ?? []}
        />
      )}

      <Card>
        <CardHead
          title="What everyone else sees about your pay"
          sub="The exact same on-chain reads, made by an account with no permission. This is your entire public pay record — three yes/no facts and four pointers that resolve to nothing."
        />
        <CardBody>
          <PublicRecordList
            isRegistered={isRegistered}
            isActive={isActive}
            lastAccrualAt={lastAccrualAt}
            rateHandle={rateHandle}
            accruedHandle={accruedHandle}
            claimedHandle={claimedHandle}
            balanceHandle={balanceHandle}
            confidentialSymbol={protocol.confidentialSymbol}
          />
        </CardBody>
      </Card>
    </div>
  );
}

/**
 * The public half of one employee's record: what any observer of Sepolia gets
 * back for these seven reads. Three booleans and four handles that resolve to
 * nothing without a grant.
 */
function PublicRecordList({
  isRegistered,
  isActive,
  lastAccrualAt,
  rateHandle,
  accruedHandle,
  claimedHandle,
  balanceHandle,
  confidentialSymbol,
}: {
  isRegistered: boolean;
  isActive: boolean;
  lastAccrualAt: bigint;
  rateHandle: Handle | undefined;
  accruedHandle: Handle | undefined;
  claimedHandle: Handle | undefined;
  balanceHandle: Handle | undefined;
  confidentialSymbol?: string;
}) {
  return (
    <div className="hairline-list">
      <KeyValue k="On the roster" v={isRegistered ? "yes" : "no"} />
      <KeyValue k="Still earning" v={isActive ? "yes" : "no (revoked)"} />
      <KeyValue
        k="Balance last written on-chain"
        v={lastAccrualAt > 0n ? formatTimestamp(lastAccrualAt) : "never"}
      />
      <KeyValue k="Salary" v={<HandleChip handle={rateHandle} />} />
      <KeyValue k="Earned so far" v={<HandleChip handle={accruedHandle} />} />
      <KeyValue k="Already paid out" v={<HandleChip handle={claimedHandle} />} />
      <KeyValue
        k={`Wallet balance (${confidentialSymbol ?? "cToken"})`}
        v={<HandleChip handle={balanceHandle} />}
      />
    </div>
  );
}

/**
 * The employee side without a wallet.
 *
 * A visitor with no wallet used to get an empty "connect first" card and no
 * reason to care. They can still read everything an observer of Sepolia can
 * read, so this shows exactly that, for a REAL address off the live roster:
 * seven public reads, four of which come back as pointers to nothing. Every
 * value is fetched from chain — there is no sample employee here, and if the
 * roster is empty the card says so rather than inventing one.
 */
function PublicPayRecord({ protocol }: { protocol: ProtocolInfo }) {
  const roster = useRoster();
  const { isConnected } = useAccount();
  const [picked, setPicked] = useState<`0x${string}` | null>(null);
  const subject = picked ?? roster.rows[0]?.employee ?? null;

  const registry = addresses?.payrollRegistry ?? ZERO_ADDRESS;
  const payroll = addresses?.noxStreamPayroll ?? ZERO_ADDRESS;
  const token = protocol.confidentialToken ?? ZERO_ADDRESS;
  const who = subject ?? ZERO_ADDRESS;

  const reads = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: registry, abi: payrollRegistryAbi, functionName: "isRegistered", args: [who] },
      { address: registry, abi: payrollRegistryAbi, functionName: "isActive", args: [who] },
      { address: registry, abi: payrollRegistryAbi, functionName: "ratePerSecondOf", args: [who] },
      { address: payroll, abi: streamPayrollAbi, functionName: "confidentialAccruedOf", args: [who] },
      { address: payroll, abi: streamPayrollAbi, functionName: "confidentialClaimedOf", args: [who] },
      { address: payroll, abi: streamPayrollAbi, functionName: "lastAccrualAt", args: [who] },
      { address: token, abi: erc7984Abi, functionName: "confidentialBalanceOf", args: [who] },
    ],
    query: { enabled: subject !== null && addresses !== null, refetchInterval: 20_000 },
  });

  const at = <T,>(index: number): T | undefined => {
    const item = reads.data?.[index];
    return item && item.status === "success" ? (item.result as T) : undefined;
  };

  if (!subject) {
    return (
      <Card>
        <CardHead
          title="What anyone can read about an employee"
          sub="Nobody has been given a salary yet, so there is no real record to show — and inventing one would defeat the point."
        />
      </Card>
    );
  }

  return (
    <Card accent>
      <CardHead
        title={
          isConnected
            ? "What you can read about somebody else's pay"
            : "No wallet? This is everything you can read about a real employee."
        }
        sub="Seven public reads against the live Sepolia contracts, for an address actually on this roster. Three come back as plain facts. The four that matter come back as pointers."
        action={
          roster.rows.length > 1 ? (
            <div className="row" style={{ gap: 6 }}>
              {roster.rows.map((row) => (
                <Button
                  key={row.employee}
                  size="sm"
                  variant={row.employee === subject ? "accent" : "ghost"}
                  onClick={() => setPicked(row.employee)}
                >
                  {shortAddress(row.employee, 3)}
                </Button>
              ))}
            </div>
          ) : undefined
        }
      />
      <CardBody className="stack-sm">
        <PublicRecordList
          isRegistered={at<boolean>(0) ?? false}
          isActive={at<boolean>(1) ?? false}
          lastAccrualAt={at<bigint>(5) ?? 0n}
          rateHandle={at<Handle>(2)}
          accruedHandle={at<Handle>(3)}
          claimedHandle={at<Handle>(4)}
          balanceHandle={at<Handle>(6)}
          confidentialSymbol={protocol.confidentialSymbol}
        />
        <p className="tiny faint">
          That is the entire leak surface for{" "}
          <span className="mono">{shortAddress(subject)}</span>: someone is
          employed here, and they were paid at some point. Connect the wallet
          that owns one of these addresses and the same four pointers turn into
          numbers — for that account and no other.
        </p>
      </CardBody>
    </Card>
  );
}

/** Marks a figure whose on-chain representation is a handle, never a number. */
function CipherMark() {
  return (
    <span
      title="The chain stores a pointer here, not this number (euint256 handle)"
      style={{ display: "inline-flex", color: "var(--cipher)" }}
    >
      <LockIcon size={11} />
    </span>
  );
}

/**
 * Proof that the claim carried no amount: the actual receipt logs, unedited.
 * `ConfidentialClaim.amount` is an indexed `euint256`, so topic[2] is a handle;
 * the only non-indexed word in the log is the epoch number.
 */
function ClaimProof({
  hash,
  logs,
  rawLogs,
}: {
  hash: `0x${string}`;
  logs: ReturnType<typeof parseEventLogs>;
  rawLogs: readonly Log[];
}) {
  const claim = logs[0] as
    | { args?: { employee?: `0x${string}`; amount?: Handle; epoch?: bigint } }
    | undefined;
  const raw = rawLogs.find((log) => log.topics.length === 3);

  return (
    <Card accent>
      <CardHead
        title="You were just paid. Here is the entire public record of it."
        sub="One transaction, and no amount anywhere inside it — not in the data, not in the event."
        action={<ExplorerLink hash={hash} />}
      />
      <CardBody className="stack-sm">
        {claim?.args?.amount ? (
          <KeyValue
            k="ConfidentialClaim.amount"
            v={<HandleChip handle={claim.args.amount} lead={10} />}
          />
        ) : (
          <p className="small muted">
            The receipt is mined; the claim event could not be decoded from these
            logs.
          </p>
        )}
        {claim?.args?.epoch !== undefined && (
          <KeyValue k="Settlement epoch" v={`#${claim.args.epoch}`} />
        )}
        {raw && (
          <div className="stack-sm">
            <span className="eyebrow">Raw log</span>
            <code className="cipher-full">
              topics[0] {raw.topics[0]}
              {"\n"}topics[1] {raw.topics[1]} (employee)
              {"\n"}topics[2] {raw.topics[2]} (euint256 handle)
              {"\n"}data{"      "}
              {raw.data} (epoch only)
            </code>
          </div>
        )}
        <p className="tiny faint">
          An observer learns that this address claimed, and when. Not how much,
          not what it earns, not what it is owed. Timing is mitigated by batching
          claims into settlement epochs, not eliminated — that is stated plainly
          rather than dressed up as anonymity.
        </p>
      </CardBody>
    </Card>
  );
}
