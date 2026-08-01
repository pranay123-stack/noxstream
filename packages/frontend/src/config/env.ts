/**
 * Typed access to build-time configuration.
 *
 * Nothing here invents an address. Every value is either supplied by the
 * operator (`.env.local`) or absent, and absence is rendered as an explicit
 * "not configured" state rather than papered over with a placeholder.
 */

function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function addr(value: unknown): `0x${string}` | undefined {
  const s = str(value);
  return s && /^0x[0-9a-fA-F]{40}$/.test(s) ? (s as `0x${string}`) : undefined;
}

const raw = import.meta.env;

export const env = {
  /** Optional dedicated Sepolia RPC. Falls back to viem's public endpoint. */
  sepoliaRpcUrl: str(raw.VITE_SEPOLIA_RPC_URL),

  /**
   * WalletConnect Cloud project id. When absent the app still works — it just
   * offers browser-injected wallets only, instead of pretending to support
   * mobile deep-links it cannot actually establish.
   */
  walletConnectProjectId: str(raw.VITE_WALLETCONNECT_PROJECT_ID),

  /**
   * Address overrides. Used when a deployment record has not been committed
   * yet but contracts exist (e.g. a fresh deploy during the demo).
   */
  addressOverrides: {
    payrollRegistry: addr(raw.VITE_PAYROLL_REGISTRY_ADDRESS),
    noxStreamPayroll: addr(raw.VITE_STREAM_PAYROLL_ADDRESS),
    confidentialPayoutToken: addr(raw.VITE_CONFIDENTIAL_TOKEN_ADDRESS),
    streamAdapter: addr(raw.VITE_STREAM_ADAPTER_ADDRESS),
    payoutAsset: addr(raw.VITE_PAYOUT_ASSET_ADDRESS),
  },

  /**
   * Block the contracts were deployed at. Log queries start here; without it
   * we fall back to a bounded look-back because public RPCs reject wide
   * `eth_getLogs` ranges.
   */
  deployBlock: (() => {
    const s = str(raw.VITE_DEPLOY_BLOCK);
    if (!s) return undefined;
    try {
      return BigInt(s);
    } catch {
      return undefined;
    }
  })(),

  /** Decimals of the public payout asset. Read on-chain when possible. */
  fallbackAssetDecimals: 6,
  fallbackAssetSymbol: "USDC",
} as const;
