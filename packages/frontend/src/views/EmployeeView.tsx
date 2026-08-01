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
import { LockIcon, RefreshIcon, ShieldIcon, UnlockIcon } from "@/components/icons";
import { formatAmount, formatDuration, formatTimestamp } from "@/lib/format";
import { ZERO_ADDRESS, type ProtocolInfo } from "@/hooks/useProtocol";
import { useTxFlow } from "@/hooks/useTxFlow";
import { useDecryption } from "@/nox/DecryptionProvider";
import { useViewMode } from "@/state/ViewModeProvider";

/**
 * The employee side. Three numbers that exist on-chain only as ciphertext, one
 * transaction that moves money without naming an amount.
 */
export function EmployeeView({ protocol }: { protocol: ProtocolInfo }) {
  const { address } = useAccount();
  const { isPrivate } = useViewMode();
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

  if (!address) {
    return (
      <Card>
        <CardBody>
          <EmptyState glyph={<ShieldIcon size={19} />} title="Connect your wallet">
            Your balance is encrypted on-chain. Reading it requires a signature
            from the account that owns it — there is nothing to show until you
            connect.
          </EmptyState>
        </CardBody>
      </Card>
    );
  }

  if (reads.isSuccess && !isRegistered) {
    return (
      <Card>
        <CardBody className="stack">
          <EmptyState glyph={<LockIcon size={19} />} title="This account is not on the roster">
            <span className="mono">{address}</span> has no allocation in the
            payroll registry, so nothing accrues to it. Roster membership is
            public by design — that part was never a secret.
          </EmptyState>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="stack-lg">
      <Card accent>
        <CardHead
          title="Your confidential balance"
          sub="Every figure below is an euint256 handle on-chain. The private view shows what a real decrypt() returns for this account, and nothing else."
          action={
            <div className="row" style={{ gap: 8 }}>
              {isActive ? (
                <Badge tone="plain">accruing</Badge>
              ) : (
                <Badge tone="warn">revoked — earned balance still claimable</Badge>
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
              The employer has not called <span className="mono">start()</span>, so
              the accrual clock is not running and{" "}
              <span className="mono">claim()</span> would revert with{" "}
              <span className="mono">PayrollNotStarted</span>. Nothing is lost —
              the clock simply has not begun.
            </Callout>
          )}

          <div className="grid-3">
            <Tile
              label="Accrued"
              badge={<ModeBadge />}
              value={
                <ConfidentialValue
                  handle={accruedHandle}
                  decimals={decimals}
                  symbol={symbol}
                  auto
                />
              }
              note={
                projected !== undefined && isPrivate
                  ? `≈ ${formatAmount(projected, decimals, 4)} ${symbol} including ${formatDuration(
                      now - Number(lastAccrualAt > 0n ? lastAccrualAt : protocol.startedAt),
                    )} since the last settle — projected locally, not yet on-chain`
                  : "Settled on-chain at the last claim or settle()"
              }
            />
            <Tile
              label="Claimed to date"
              badge={<ModeBadge />}
              value={
                <ConfidentialValue
                  handle={claimedHandle}
                  decimals={decimals}
                  symbol={symbol}
                  auto
                />
              }
              note="Never appears as a number in any event"
            />
            <Tile
              label="Claimable now"
              badge={<ModeBadge />}
              value={
                isPrivate ? (
                  claimable === undefined ? (
                    <span className="small faint">
                      decrypt accrued and claimed to derive this
                    </span>
                  ) : (
                    <span className="plainvalue">
                      {formatAmount(claimable, decimals)}
                      <span className="plainvalue-unit">{symbol}</span>
                    </span>
                  )
                ) : (
                  <span className="small faint">
                    not a stored value — accrued − claimed, both ciphertext
                  </span>
                )
              }
              note="Computed in your browser from two decrypted values"
            />
          </div>

          <div className="grid-2">
            <div className="tile">
              <span className="tile-label">
                Your salary rate <ModeBadge />
              </span>
              <ConfidentialValue
                handle={rateHandle}
                decimals={decimals}
                symbol={symbol}
                kind="rate"
                auto
              />
              {rate.stage === "done" && isPrivate && (
                <span className="tile-note mono">
                  {rate.value?.toString()} base units/second ×{" "}
                  {SECONDS_PER_MONTH.toString()} s/month
                </span>
              )}
            </div>
            <div className="tile">
              <span className="tile-label">
                Wallet balance ({protocol.confidentialSymbol ?? `c${symbol}`}){" "}
                <ModeBadge />
              </span>
              <ConfidentialValue
                handle={balanceHandle}
                decimals={decimals}
                symbol={protocol.confidentialSymbol ?? `c${symbol}`}
              />
              <span className="tile-note">
                An ERC-7984 balance is itself a handle — even your wallet total is
                ciphertext until you unwrap.
              </span>
            </div>
          </div>

          <div className="row">
            <Button
              variant="mode"
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
              Roll accrual forward
            </Button>
            <span className="tiny faint">
              An over-claim never reverts: it silently settles to the correct
              amount, because a revert would leak the comparison.
            </span>
          </div>

          {vaultUnfunded && (
            <Callout tone="warn" title="Nothing has been harvested into the vault yet">
              <div className="stack-sm">
                <span>
                  Funds have unlocked in the public stream but nobody has moved
                  them into the confidential vault.{" "}
                  <span className="mono">harvest()</span> is permissionless, so you
                  can do it yourself — you are not waiting on the employer.
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
          title="What this account looks like to everyone else"
          sub="Same reads, no ACL grant. This is the public record of your pay."
        />
        <CardBody>
          <div className="hairline-list">
            <KeyValue k="On the roster" v={isRegistered ? "yes" : "no"} />
            <KeyValue k="Still accruing" v={isActive ? "yes" : "no (revoked)"} />
            <KeyValue
              k="Last settled"
              v={lastAccrualAt > 0n ? formatTimestamp(lastAccrualAt) : "never"}
            />
            <KeyValue k="Salary rate" v={<HandleChip handle={rateHandle} />} />
            <KeyValue k="Accrued" v={<HandleChip handle={accruedHandle} />} />
            <KeyValue k="Claimed" v={<HandleChip handle={claimedHandle} />} />
            <KeyValue
              k={`${protocol.confidentialSymbol ?? "cToken"} balance`}
              v={<HandleChip handle={balanceHandle} />}
            />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function ModeBadge() {
  const { isPrivate } = useViewMode();
  return isPrivate ? (
    <UnlockIcon size={11} style={{ color: "var(--plain)" }} />
  ) : (
    <LockIcon size={11} style={{ color: "var(--cipher)" }} />
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
        title="The claim, as the chain recorded it"
        sub="One transaction. No amount anywhere in it."
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
          not what it earns, not what it is owed. Timing is mitigated by epoch
          batching, not eliminated — that is stated plainly rather than dressed
          up as anonymity.
        </p>
      </CardBody>
    </Card>
  );
}
