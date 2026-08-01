import { useState } from "react";
import { formatEther } from "viem";
import { useAccount, useReadContracts, useSimulateContract } from "wagmi";
import { TARGET_NETWORK } from "@shared/nox";
import { addresses } from "@/config/deployments";
import {
  erc20Abi,
  mintableErc20Abi,
  streamAdapterAbi,
  streamPayrollAbi,
} from "@/contracts/abis";
import { formatAmount, formatTimestamp, parseAmount } from "@/lib/format";
import { useTxFlow } from "@/hooks/useTxFlow";
import { ZERO_ADDRESS, type ProtocolInfo } from "@/hooks/useProtocol";
import { HarvestControls } from "@/components/HarvestControls";
import { TxNote } from "@/components/TxNote";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardBody,
  CardHead,
  Field,
  Input,
  Tile,
} from "@/components/ui";
import { ExternalIcon, StreamIcon } from "@/components/icons";

/**
 * The public half of NoxStream, presented as public.
 *
 * Everything here is a plain number anyone can read, and that is the point: the
 * aggregate stays auditable and composable while only the per-employee split
 * moves into the TEE. Nothing on this panel is redacted in the private view
 * either — there is nothing here to redact.
 */
export function StreamPanel({
  protocol,
  isEmployer,
}: {
  protocol: ProtocolInfo;
  isEmployer: boolean;
}) {
  const { address } = useAccount();
  const adapter = addresses?.streamAdapter;
  const payroll = addresses?.noxStreamPayroll;
  const asset = protocol.assetAddress;
  const { assetDecimals: decimals, assetSymbol: symbol } = protocol;

  const [amount, setAmount] = useState("");
  const [days, setDays] = useState("30");
  const approveTx = useTxFlow();
  const fundTx = useTxFlow();
  const startTx = useTxFlow();
  const mintTx = useTxFlow();

  const wallet = useReadContracts({
    allowFailure: true,
    contracts: [
      {
        address: asset ?? ZERO_ADDRESS,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address ?? ZERO_ADDRESS],
      },
      {
        address: asset ?? ZERO_ADDRESS,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address ?? ZERO_ADDRESS, adapter ?? ZERO_ADDRESS],
      },
    ],
    query: { enabled: Boolean(asset && address && adapter), refetchInterval: 15_000 },
  });

  const balance =
    wallet.data?.[0]?.status === "success"
      ? (wallet.data[0].result as bigint)
      : undefined;
  const allowance =
    wallet.data?.[1]?.status === "success" ? (wallet.data[1].result as bigint) : 0n;

  /**
   * The testnet asset is MockUSDC with an open `mint`; real USDC is not. We do
   * not assume either — a simulate call tells us whether the faucet exists on
   * whatever asset this deployment actually points at.
   */
  const faucetProbe = useSimulateContract({
    address: asset ?? ZERO_ADDRESS,
    abi: mintableErc20Abi,
    functionName: "mint",
    args: [address ?? ZERO_ADDRESS, 1_000n],
    query: { enabled: Boolean(asset && address), retry: false },
  });
  const hasFaucet = faucetProbe.isSuccess;

  let parsedAmount: bigint | null = null;
  let amountError: string | undefined;
  if (amount.trim()) {
    try {
      parsedAmount = parseAmount(amount, decimals);
      if (parsedAmount <= 0n) amountError = "Must be greater than zero";
      else if (balance !== undefined && parsedAmount > balance) {
        amountError = `Wallet holds ${formatAmount(balance, decimals)} ${symbol}`;
      }
    } catch (error) {
      amountError = error instanceof Error ? error.message : "Invalid amount";
    }
  }

  const durationSeconds = Math.max(0, Math.floor(Number(days) * 86_400));
  const needsApproval =
    parsedAmount !== null && allowance < parsedAmount && !amountError;
  const streamOpen = (protocol.streamId ?? 0n) > 0n;

  return (
    <Card>
      <CardHead
        title="Aggregate stream"
        sub="Public on purpose — one ordinary Sablier stream, one recipient, fully composable."
        action={
          protocol.protocolTag ? (
            <Badge>{protocol.protocolTag}</Badge>
          ) : (
            <Badge tone="warn">adapter unread</Badge>
          )
        }
      />
      <CardBody className="stack">
        {!protocol.adapterReadable && (
          <Callout tone="warn" title="Stream adapter is not answering">
            The address in the deployment record does not respond to{" "}
            <span className="mono">streamId()</span> /{" "}
            <span className="mono">withdrawableAmount()</span>. Payroll accrual and
            confidential claims still work; only the funding panel below is
            unavailable.
          </Callout>
        )}

        <div className="grid-3">
          <Tile
            label="Held by the stream"
            value={
              protocol.adapterBalance === undefined
                ? "—"
                : formatAmount(protocol.adapterBalance, decimals)
            }
            note={`${symbol} locked or unharvested`}
          />
          <Tile
            label="Unlocked, unharvested"
            value={
              protocol.withdrawable === undefined
                ? "—"
                : formatAmount(protocol.withdrawable, decimals)
            }
            note="Anyone can push this into the vault"
          />
          <Tile
            label="In the confidential vault"
            value={
              protocol.vaultBalance === undefined
                ? "—"
                : formatAmount(protocol.vaultBalance, decimals)
            }
            note={`Wrapped as ${protocol.confidentialSymbol ?? `c${symbol}`}`}
          />
        </div>

        <div className="grid-3">
          <Tile
            label="Sablier stream"
            value={
              streamOpen ? (
                protocol.lockupAddress ? (
                  <a
                    className="link"
                    href={`${TARGET_NETWORK.explorer}/address/${protocol.lockupAddress}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    style={{ display: "inline-flex", gap: 5, alignItems: "center" }}
                  >
                    #{String(protocol.streamId)}
                    <ExternalIcon size={12} />
                  </a>
                ) : (
                  `#${protocol.streamId}`
                )
              ) : (
                "none"
              )
            }
            note={streamOpen ? "Verify it independently on Lockup" : undefined}
          />
          <Tile
            label="Payroll clock"
            value={protocol.hasStarted ? "running" : "not started"}
            note={
              protocol.hasStarted
                ? `since ${formatTimestamp(protocol.startedAt)}`
                : "accrual begins at start()"
            }
          />
          <Tile
            label="Adapter fee tank"
            value={
              protocol.feeTank === undefined
                ? "—"
                : `${Number(formatEther(protocol.feeTank)).toFixed(5)} ETH`
            }
            note={
              protocol.minHarvestFee === undefined
                ? "Sablier charges a fee per withdrawal"
                : `${Number(formatEther(protocol.minHarvestFee)).toFixed(6)} ETH per harvest`
            }
            badge={
              protocol.canHarvest ? undefined : <Badge tone="warn">empty</Badge>
            }
          />
        </div>

        {isEmployer && !streamOpen && protocol.adapterReadable && (
          <div className="stack-sm">
            <span className="eyebrow">Fund the aggregate stream</span>
            <div className="grid-2">
              <Field
                label={`Total ${symbol}`}
                error={amountError}
                hint={
                  balance === undefined
                    ? undefined
                    : `Wallet balance ${formatAmount(balance, decimals)} ${symbol}`
                }
              >
                <Input
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="60000"
                  inputMode="decimal"
                  className="mono"
                  invalid={Boolean(amountError)}
                />
              </Field>
              <Field
                label="Duration (days)"
                hint={`${durationSeconds.toLocaleString()} seconds`}
              >
                <Input
                  value={days}
                  onChange={(event) => setDays(event.target.value)}
                  inputMode="numeric"
                  className="mono"
                />
              </Field>
            </div>
            <div className="row">
              {needsApproval ? (
                <Button
                  variant="primary"
                  loading={approveTx.isBusy}
                  onClick={() =>
                    void approveTx
                      .send({
                        address: asset!,
                        abi: erc20Abi,
                        functionName: "approve",
                        args: [adapter!, parsedAmount!],
                      })
                      .then(() => wallet.refetch())
                  }
                >
                  Approve {formatAmount(parsedAmount!, decimals)} {symbol}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  disabled={
                    !parsedAmount || Boolean(amountError) || durationSeconds <= 0
                  }
                  loading={fundTx.isBusy}
                  onClick={() =>
                    void fundTx
                      .send({
                        address: adapter!,
                        abi: streamAdapterAbi,
                        functionName: "fundStream",
                        args: [parsedAmount!, durationSeconds],
                      })
                      .then(() => {
                        protocol.refetch();
                        void wallet.refetch();
                      })
                  }
                >
                  <StreamIcon size={13} />
                  Fund stream
                </Button>
              )}
              {hasFaucet && (
                <Button
                  variant="ghost"
                  loading={mintTx.isBusy}
                  onClick={() =>
                    void mintTx
                      .send({
                        address: asset!,
                        abi: mintableErc20Abi,
                        functionName: "mint",
                        args: [address!, 100_000n * 10n ** BigInt(decimals)],
                      })
                      .then(() => wallet.refetch())
                  }
                >
                  Mint 100,000 test {symbol}
                </Button>
              )}
            </div>
            <p className="tiny faint">
              The total and the schedule are visible to everyone. That is the
              deal: the aggregate is public so it stays auditable, the split is
              not.
            </p>
            <TxNote flow={approveTx} label="Approval" />
            <TxNote flow={fundTx} label="Funding" />
            <TxNote flow={mintTx} label="Test mint" />
          </div>
        )}

        <div className="row">
          {isEmployer && !protocol.hasStarted && (
            <Button
              variant="mode"
              loading={startTx.isBusy}
              disabled={!payroll}
              onClick={() =>
                void startTx
                  .send({
                    address: payroll!,
                    abi: streamPayrollAbi,
                    functionName: "start",
                  })
                  .then(() => protocol.refetch())
              }
            >
              Start payroll
            </Button>
          )}
          {isEmployer && !protocol.hasStarted && (
            <span className="tiny faint">
              Accrual is zero until this is called, and it can only be called
              once.
            </span>
          )}
        </div>
        <TxNote flow={startTx} label="Start" />

        <HarvestControls protocol={protocol} />
      </CardBody>
    </Card>
  );
}
