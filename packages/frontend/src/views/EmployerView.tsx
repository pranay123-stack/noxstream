import { useAccount } from "wagmi";
import { AllocationComposer } from "@/components/employer/AllocationComposer";
import { StreamPanel } from "@/components/employer/StreamPanel";
import { RosterTable } from "@/components/RosterTable";
import { Badge, Button, Callout, Card, CardBody, CardHead } from "@/components/ui";
import { RefreshIcon } from "@/components/icons";
import { ZERO_ADDRESS, type ProtocolInfo } from "@/hooks/useProtocol";
import { useRoster } from "@/hooks/useRoster";
import { shortAddress } from "@/nox/handle";

/**
 * Order is the argument.
 *
 * The roster table is the demonstration — one column holds the bytes every
 * observer of Sepolia gets, the next holds what this particular account can
 * actually turn them into. It therefore comes FIRST, immediately under the
 * tabs. The form that writes salaries and the public stream that funds them
 * are how it works, not what it proves, so they follow.
 */
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
          Allocations submitted now would never settle, because the registry does
          not know which contract is allowed to compute on them.{" "}
          <span className="mono">registry.payroll()</span> is the zero address;{" "}
          <span className="mono">setPayroll(address)</span> is a one-time deploy
          step and has to be run by the employer before this screen is useful.
        </Callout>
      )}

      <Card accent>
        <CardHead
          title="Who gets paid — and what the chain gives away"
          sub={
            <>
              Employee addresses are public, on purpose. Salaries are not: each
              one is stored as an encrypted pointer, and it only becomes a number
              for an account that was granted permission to read that exact
              value. Every row below shows both halves at once.
            </>
          }
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

      <AllocationComposer
        decimals={protocol.assetDecimals}
        symbol={protocol.assetSymbol}
        isEmployer={isEmployer}
        onSubmitted={() => {
          roster.refetch();
          protocol.refetch();
        }}
      />

      <StreamPanel protocol={protocol} isEmployer={isEmployer} />

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
