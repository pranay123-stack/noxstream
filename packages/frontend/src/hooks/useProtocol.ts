import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import { addresses } from "@/config/deployments";
import { env } from "@/config/env";
import {
  erc20Abi,
  erc7984Abi,
  payrollRegistryAbi,
  streamAdapterAbi,
  streamPayrollAbi,
} from "@/contracts/abis";

/**
 * One batched read of everything public about the deployment.
 *
 * All of this is deliberately visible — the aggregate is what keeps NoxStream
 * auditable and composable. Per-call failures are tolerated (`allowFailure`)
 * because a component may be missing or unwired, and "we could not read the
 * stream adapter" must not take the whole page down.
 */

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export interface ProtocolInfo {
  ready: boolean;
  isLoading: boolean;
  refetch: () => void;

  /** Registry */
  employer?: `0x${string}`;
  /** The payroll contract the registry is wired to. Zero = `setPayroll` never ran. */
  wiredPayroll?: `0x${string}`;
  employeeCount: number;

  /** Payroll */
  startedAt: bigint;
  hasStarted: boolean;
  currentEpoch: bigint;
  confidentialToken?: `0x${string}`;

  /** Stream adapter — may be entirely unavailable. */
  adapterReadable: boolean;
  streamId?: bigint;
  withdrawable?: bigint;
  protocolTag?: string;
  /**
   * Sablier v3.0+ takes a native-token fee per withdrawal, so the adapter keeps
   * an ETH tank. When it runs dry `harvest()` reverts — which would otherwise
   * look like an unexplained failure, so the UI reads it and says so.
   */
  feeTank?: bigint;
  minHarvestFee?: bigint;
  /** False when the tank cannot cover the next Sablier withdrawal fee. */
  canHarvest: boolean;
  /** The underlying Sablier Lockup contract, read off the adapter. */
  lockupAddress?: `0x${string}`;

  /** Public payout asset */
  assetAddress?: `0x${string}`;
  assetDecimals: number;
  assetSymbol: string;
  /** Public ERC-20 still held by the stream adapter (locked + unharvested). */
  adapterBalance?: bigint;
  /** Public ERC-20 wrapped inside the confidential vault. */
  vaultBalance?: bigint;

  confidentialSymbol?: string;
}

export function useProtocol(): ProtocolInfo {
  const registry = addresses?.payrollRegistry ?? ZERO_ADDRESS;
  const payroll = addresses?.noxStreamPayroll ?? ZERO_ADDRESS;
  const adapter = addresses?.streamAdapter ?? ZERO_ADDRESS;
  const enabled = addresses !== null;

  const core = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: registry, abi: payrollRegistryAbi, functionName: "employer" },
      { address: registry, abi: payrollRegistryAbi, functionName: "payroll" },
      { address: registry, abi: payrollRegistryAbi, functionName: "employeeCount" },
      { address: payroll, abi: streamPayrollAbi, functionName: "startedAt" },
      { address: payroll, abi: streamPayrollAbi, functionName: "currentEpoch" },
      { address: payroll, abi: streamPayrollAbi, functionName: "payoutAsset" },
      { address: payroll, abi: streamPayrollAbi, functionName: "confidentialToken" },
      { address: adapter, abi: streamAdapterAbi, functionName: "streamId" },
      { address: adapter, abi: streamAdapterAbi, functionName: "withdrawableAmount" },
      { address: adapter, abi: streamAdapterAbi, functionName: "protocolTag" },
      { address: adapter, abi: streamAdapterAbi, functionName: "feeTankBalance" },
      { address: adapter, abi: streamAdapterAbi, functionName: "minHarvestFeeWei" },
      { address: adapter, abi: streamAdapterAbi, functionName: "LOCKUP" },
    ],
    query: { enabled, refetchInterval: 15_000 },
  });

  const coreData = core.data;
  const pick = <T,>(index: number): T | undefined => {
    const item = coreData?.[index];
    return item && item.status === "success" ? (item.result as T) : undefined;
  };

  const assetAddress = pick<`0x${string}`>(5) ?? addresses?.payoutAsset ?? ZERO_ADDRESS;
  const confidentialToken =
    pick<`0x${string}`>(6) ?? addresses?.confidentialPayoutToken ?? ZERO_ADDRESS;

  const assetInfo = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: assetAddress, abi: erc20Abi, functionName: "symbol" },
      { address: assetAddress, abi: erc20Abi, functionName: "decimals" },
      {
        address: assetAddress,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [adapter],
      },
      {
        address: assetAddress,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [confidentialToken],
      },
      { address: confidentialToken, abi: erc7984Abi, functionName: "symbol" },
    ],
    query: { enabled: enabled && assetAddress !== ZERO_ADDRESS, refetchInterval: 15_000 },
  });

  const assetData = assetInfo.data;
  const { refetch: refetchCore } = core;
  const { refetch: refetchAsset } = assetInfo;

  return useMemo(() => {
    const at = <T,>(index: number): T | undefined => {
      const item = coreData?.[index];
      return item && item.status === "success" ? (item.result as T) : undefined;
    };
    const assetAt = <T,>(index: number): T | undefined => {
      const item = assetData?.[index];
      return item && item.status === "success" ? (item.result as T) : undefined;
    };

    const startedAt = at<bigint>(3) ?? 0n;
    const streamId = at<bigint>(7);
    const withdrawable = at<bigint>(8);
    const feeTank = at<bigint>(10);
    const minHarvestFee = at<bigint>(11);

    return {
      ready: enabled && core.isSuccess,
      isLoading: core.isLoading || assetInfo.isLoading,
      refetch: () => {
        void refetchCore();
        void refetchAsset();
      },

      employer: at<`0x${string}`>(0),
      wiredPayroll: at<`0x${string}`>(1),
      employeeCount: Number(at<bigint>(2) ?? 0n),

      startedAt,
      hasStarted: startedAt > 0n,
      currentEpoch: at<bigint>(4) ?? 0n,
      confidentialToken:
        confidentialToken === ZERO_ADDRESS ? undefined : confidentialToken,

      adapterReadable: streamId !== undefined || withdrawable !== undefined,
      streamId,
      withdrawable,
      protocolTag: at<string>(9),
      feeTank,
      minHarvestFee,
      lockupAddress: at<`0x${string}`>(12),
      canHarvest:
        feeTank === undefined ||
        minHarvestFee === undefined ||
        feeTank >= minHarvestFee,

      assetAddress: assetAddress === ZERO_ADDRESS ? undefined : assetAddress,
      assetDecimals: assetAt<number>(1) ?? env.fallbackAssetDecimals,
      assetSymbol: assetAt<string>(0) ?? env.fallbackAssetSymbol,
      adapterBalance: assetAt<bigint>(2),
      vaultBalance: assetAt<bigint>(3),
      confidentialSymbol: assetAt<string>(4),
    };
  }, [
    coreData,
    assetData,
    core.isLoading,
    core.isSuccess,
    assetInfo.isLoading,
    enabled,
    assetAddress,
    confidentialToken,
    refetchCore,
    refetchAsset,
  ]);
}
