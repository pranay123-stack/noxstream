import { formatEther, parseEther } from "viem";
import { addresses } from "@/config/deployments";
import { streamPayrollAbi } from "@/contracts/abis";
import { useTxFlow } from "@/hooks/useTxFlow";
import type { ProtocolInfo } from "@/hooks/useProtocol";
import { Button, Callout } from "./ui";
import { TxNote } from "./TxNote";

/**
 * `harvest()` moves unlocked funds from the public stream into the confidential
 * vault. It is permissionless — an employee never has to wait for the employer.
 *
 * The catch, and it is a real one: Sablier v3.0+ charges a native-token fee per
 * withdrawal, so the adapter carries an ETH tank and reverts with
 * `InsufficientFeeTank` when it runs dry. That would read as an unexplained
 * failure, so we read the tank up front, gate the button on it, and offer the
 * fix — a plain ETH transfer, which the adapter's open `receive()` accepts from
 * anyone.
 */
export function HarvestControls({
  protocol,
  onDone,
  compact,
}: {
  protocol: ProtocolInfo;
  onDone?: () => void;
  compact?: boolean;
}) {
  const payroll = addresses?.noxStreamPayroll;
  const adapter = addresses?.streamAdapter;
  const harvestTx = useTxFlow();
  const topUpTx = useTxFlow();

  const tankShort = !protocol.canHarvest;
  const shortfall =
    protocol.minHarvestFee !== undefined && protocol.feeTank !== undefined
      ? protocol.minHarvestFee - protocol.feeTank
      : undefined;
  // Enough for roughly twenty withdrawals, so a demo is not a fee-tank chore.
  const topUpAmount =
    protocol.minHarvestFee !== undefined && protocol.minHarvestFee > 0n
      ? protocol.minHarvestFee * 20n
      : parseEther("0.01");

  return (
    <div className="stack-sm">
      <div className="row">
        <Button
          variant="ghost"
          loading={harvestTx.isBusy}
          disabled={!payroll || tankShort}
          onClick={() =>
            void harvestTx
              .send({
                address: payroll!,
                abi: streamPayrollAbi,
                functionName: "harvest",
              })
              .then(() => {
                protocol.refetch();
                onDone?.();
              })
          }
        >
          Harvest into the vault
        </Button>
        {!compact && (
          <span className="tiny faint">
            <span className="mono">harvest()</span> is permissionless — employees
            never depend on the employer being online.
          </span>
        )}
      </div>

      {tankShort && (
        <Callout
          tone="warn"
          title="Harvest unavailable: the stream adapter is out of gas fees"
          action={
            <Button
              size="sm"
              loading={topUpTx.isBusy}
              disabled={!adapter}
              onClick={() =>
                void topUpTx.sendEth(adapter!, topUpAmount).then(() => protocol.refetch())
              }
            >
              Top up {formatEther(topUpAmount)} ETH
            </Button>
          }
        >
          Sablier charges{" "}
          <span className="mono">
            {protocol.minHarvestFee !== undefined
              ? `${formatEther(protocol.minHarvestFee)} ETH`
              : "a native-token fee"}
          </span>{" "}
          per withdrawal. The adapter holds{" "}
          <span className="mono">
            {protocol.feeTank !== undefined ? formatEther(protocol.feeTank) : "?"} ETH
          </span>
          {shortfall !== undefined && shortfall > 0n && (
            <>
              {" "}
              — short by{" "}
              <span className="mono">{formatEther(shortfall)} ETH</span>
            </>
          )}
          . Anyone can refill it; the adapter's <span className="mono">receive()</span>{" "}
          is open, so you are not blocked on the employer.
        </Callout>
      )}

      <TxNote flow={topUpTx} label="Fee tank top-up" />
      <TxNote flow={harvestTx} label="Harvest" />
    </div>
  );
}
