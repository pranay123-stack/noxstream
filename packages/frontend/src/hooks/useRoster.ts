import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import type { Handle } from "@shared/nox";
import { addresses } from "@/config/deployments";
import { payrollRegistryAbi } from "@/contracts/abis";
import { ZERO_ADDRESS } from "./useProtocol";

/**
 * The on-chain roster, read exactly as an observer would read it.
 *
 * Membership is public by design (it is what makes the aggregate stream
 * auditable); the rate is a handle. `isActive` distinguishes "still accruing"
 * from "revoked" — a revoked employee stays on the roster and may still have a
 * claimable balance, so rendering them as simply gone would be wrong.
 */

export interface RosterRow {
  employee: `0x${string}`;
  rateHandle: Handle | undefined;
  isActive: boolean;
  isRegistered: boolean;
}

export interface RosterState {
  rows: RosterRow[];
  count: number;
  isLoading: boolean;
  refetch: () => void;
}

export function useRoster(): RosterState {
  const registry = addresses?.payrollRegistry ?? ZERO_ADDRESS;
  const enabled = addresses !== null;

  const countRead = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: registry, abi: payrollRegistryAbi, functionName: "employeeCount" },
    ],
    query: { enabled, refetchInterval: 20_000 },
  });

  const countResult = countRead.data?.[0];
  const count =
    countResult && countResult.status === "success" ? Number(countResult.result) : 0;

  const addressRead = useReadContracts({
    allowFailure: true,
    contracts: Array.from({ length: count }, (_, index) => ({
      address: registry,
      abi: payrollRegistryAbi,
      functionName: "employeeAt" as const,
      args: [BigInt(index)] as const,
    })),
    query: { enabled: enabled && count > 0 },
  });

  const employees = useMemo(() => {
    return (addressRead.data ?? [])
      .map((item) =>
        item.status === "success" ? (item.result as `0x${string}`) : undefined,
      )
      .filter((a): a is `0x${string}` => Boolean(a));
  }, [addressRead.data]);

  const detailRead = useReadContracts({
    allowFailure: true,
    contracts: employees.flatMap((employee) => [
      {
        address: registry,
        abi: payrollRegistryAbi,
        functionName: "ratePerSecondOf" as const,
        args: [employee] as const,
      },
      {
        address: registry,
        abi: payrollRegistryAbi,
        functionName: "isActive" as const,
        args: [employee] as const,
      },
      {
        address: registry,
        abi: payrollRegistryAbi,
        functionName: "isRegistered" as const,
        args: [employee] as const,
      },
    ]),
    query: { enabled: employees.length > 0, refetchInterval: 20_000 },
  });

  const detailData = detailRead.data;
  const { refetch: refetchCount } = countRead;
  const { refetch: refetchAddresses } = addressRead;
  const { refetch: refetchDetails } = detailRead;

  return useMemo(() => {
    const rows: RosterRow[] = employees.map((employee, index) => {
      const rate = detailData?.[index * 3];
      const active = detailData?.[index * 3 + 1];
      const registered = detailData?.[index * 3 + 2];
      return {
        employee,
        rateHandle:
          rate && rate.status === "success" ? (rate.result as Handle) : undefined,
        isActive: active?.status === "success" ? Boolean(active.result) : false,
        isRegistered:
          registered?.status === "success" ? Boolean(registered.result) : true,
      };
    });

    return {
      rows,
      count,
      isLoading: countRead.isLoading || addressRead.isLoading || detailRead.isLoading,
      refetch: () => {
        void refetchCount();
        void refetchAddresses();
        void refetchDetails();
      },
    };
  }, [
    employees,
    detailData,
    count,
    countRead.isLoading,
    addressRead.isLoading,
    detailRead.isLoading,
    refetchCount,
    refetchAddresses,
    refetchDetails,
  ]);
}
