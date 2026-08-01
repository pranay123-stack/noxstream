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
  Disclosure,
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
 * moves into the TEE. Nothing on this panel is ever redacted — there is nothing
 * here to redact.
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

  const vaultSymbol = protocol.confidentialSymbol ?? `c${symbol}`;

  return (
    <Card>
      <CardHead
        title="The public stream that funds everyone"
        sub="Deliberately public: one ordinary Sablier stream paying one recipient. The company total is auditable and composable — the split between employees is what stays private."
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

        {protocol.ready && !protocol.hasStarted && (
          <Callout tone="warn" title="The payroll clock has not been started yet">
            Salaries can be written to the registry, but nothing accrues until
            the employer calls <span className="mono">start()</span> once. Nothing
            is lost — the clock simply has not begun.
          </Callout>
        )}

        <div className="grid-3">
          <Tile
            label="Unlocked, ready to move"
            term="adapter.withdrawableAmount()"
            value={
              protocol.withdrawable === undefined
                ? "—"
                : formatAmount(protocol.withdrawable, decimals)
            }
            note={
              protocol.withdrawable === 0n
                ? `No ${symbol} has unlocked since the last move — the stream releases funds gradually.`
                : `${symbol} the stream has released. Anyone can move it into the private vault.`
            }
          />
          <Tile
            label="Available to pay salaries"
            term={`${vaultSymbol} vault balance`}
            value={
              protocol.vaultBalance === undefined
                ? "—"
                : formatAmount(protocol.vaultBalance, decimals)
            }
            note={
              protocol.vaultBalance === 0n
                ? `Nothing moved in yet — claims wait until someone runs the move below.`
                : `${symbol} held privately as ${vaultSymbol}; claims are paid from here.`
            }
          />
          <Tile
            label="The stream itself"
            term="Sablier Lockup"
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
                "none yet"
              )
            }
            note={
              streamOpen
                ? "Verify it yourself on Sablier — it is an ordinary stream and does not know NoxStream exists."
                : "No stream has been funded yet."
            }
          />
        </div>

        {isEmployer && !streamOpen && protocol.adapterReadable && (
          <div className="stack-sm">
            <span className="eyebrow">Open the stream that funds payroll</span>
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
              variant="accent"
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
              once. <span className="mono">payroll.start()</span>
            </span>
          )}
        </div>
        <TxNote flow={startTx} label="Start" />

        <HarvestControls protocol={protocol} />

        <Disclosure
          summary="Technical details"
          hint="fee tank, adapter balance, accrual clock"
        >
          <div className="grid-3">
            <Tile
              label="Gas for payouts"
              term="adapter fee tank"
              value={
                protocol.feeTank === undefined
                  ? "—"
                  : `${Number(formatEther(protocol.feeTank)).toFixed(5)} ETH`
              }
              note={
                protocol.minHarvestFee === undefined
                  ? "Sablier charges a native-token fee every time funds are pulled out of the stream. The adapter keeps ETH on hand to pay it; anyone may top it up."
                  : `Sablier charges ${Number(formatEther(protocol.minHarvestFee)).toFixed(6)} ETH each time funds are pulled out of the stream. The adapter keeps ETH on hand to pay it; anyone may top it up.`
              }
              badge={
                protocol.canHarvest ? undefined : <Badge tone="warn">empty</Badge>
              }
            />
            <Tile
              label="Sitting in the adapter contract"
              term={`${symbol}.balanceOf(adapter)`}
              value={
                protocol.adapterBalance === undefined
                  ? "—"
                  : formatAmount(protocol.adapterBalance, decimals)
              }
              note={
                protocol.adapterBalance === 0n
                  ? "Zero is the healthy state: a move forwards everything into the vault in the same transaction, so this contract never sits on funds."
                  : `${symbol} withdrawn from the stream but not yet forwarded into the vault.`
              }
            />
            <Tile
              label="Accrual clock"
              term="payroll.startedAt()"
              value={protocol.hasStarted ? "running" : "not started"}
              note={
                protocol.hasStarted
                  ? `Salaries have been building up since ${formatTimestamp(protocol.startedAt)}.`
                  : "Nothing accrues until the employer calls start() once."
              }
            />
          </div>
        </Disclosure>
      </CardBody>
    </Card>
  );
}
