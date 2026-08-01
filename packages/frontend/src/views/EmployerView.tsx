import { useAccount } from "wagmi";
import { AllocationComposer } from "@/components/employer/AllocationComposer";
import { StreamPanel } from "@/components/employer/StreamPanel";
import { RosterTable } from "@/components/RosterTable";
import { Badge, Button, Callout, Card, CardBody, CardHead } from "@/components/ui";
import { RefreshIcon } from "@/components/icons";
import { ZERO_ADDRESS, type ProtocolInfo } from "@/hooks/useProtocol";
import { useRoster } from "@/hooks/useRoster";
import { shortAddress } from "@/nox/handle";

export function EmployerView({ protocol }: { protocol: ProtocolInfo }) {
  const { address } = useAccount();
  const roster = useRoster();

  const isEmployer =
    Boolean(address) &&
    Boolean(protocol.employer) &&
    address!.toLowerCase() === protocol.employer!.toLowerCase();

  const payrollUnwired =
    protocol.ready &&
    (protocol.wiredPayroll === undefined || protocol.wiredPayroll === ZERO_ADDRESS);

  return (
    <div className="stack-lg">
      {payrollUnwired && (
        <Callout tone="danger" title="The registry is not wired to a payroll contract">
          <span className="mono">registry.payroll()</span> is the zero address, so
          allocations submitted now would never settle.{" "}
          <span className="mono">setPayroll(address)</span> is a one-time deploy
          step and has to be run by the employer before this screen is useful.
        </Callout>
      )}

      <StreamPanel protocol={protocol} isEmployer={isEmployer} />

      <AllocationComposer
        decimals={protocol.assetDecimals}
        symbol={protocol.assetSymbol}
        isEmployer={isEmployer}
        onSubmitted={() => {
          roster.refetch();
          protocol.refetch();
        }}
      />

      <Card accent>
        <CardHead
          title="Roster on-chain"
          sub="Addresses are public; rates are euint256 handles. Every row shows the handle and then what this account can actually read from it — a number where you hold an ACL grant, nothing where you do not."
          action={
            <div className="row" style={{ gap: 8 }}>
              <Badge>
                {roster.count} employee{roster.count === 1 ? "" : "s"}
              </Badge>
              <Button size="sm" variant="ghost" onClick={roster.refetch}>
                <RefreshIcon size={12} />
                Refresh
              </Button>
            </div>
          }
        />
        <CardBody>
          <RosterTable
            rows={roster.rows}
            decimals={protocol.assetDecimals}
            symbol={protocol.assetSymbol}
            isLoading={roster.isLoading}
          />
        </CardBody>
      </Card>

      {protocol.employer && (
        <p className="tiny faint">
          Employer of record:{" "}
          <span className="mono">{shortAddress(protocol.employer)}</span>
          {isEmployer ? " — that is this account." : " — connect it to make changes."}
        </p>
      )}
    </div>
  );
}
