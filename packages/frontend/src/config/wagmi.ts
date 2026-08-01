import {
  connectorsForWallets,
  type WalletList,
} from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  rainbowWallet,
  safeWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { sepolia } from "wagmi/chains";
import { env } from "./env";

export const APP_NAME = "NoxStream";

/**
 * WalletConnect is optional on purpose.
 *
 * A project id is a per-deployment secret from cloud.walletconnect.com; we read
 * it from `VITE_WALLETCONNECT_PROJECT_ID` and never ship one. When it is
 * missing we drop the connectors that genuinely require it (QR / mobile
 * pairing) instead of registering them with a fake id — a fake id fails at
 * connect time with an opaque relay error, which is a much worse experience
 * than simply not offering the option.
 */
export const walletConnectProjectId = env.walletConnectProjectId;
export const hasWalletConnect = walletConnectProjectId !== undefined;

function buildWalletList(): WalletList {
  const installed: WalletList[number] = {
    groupName: "Browser wallet",
    wallets: [injectedWallet, safeWallet],
  };
  if (!hasWalletConnect) return [installed];

  return [
    installed,
    {
      groupName: "Popular",
      wallets: [metaMaskWallet, rainbowWallet, coinbaseWallet, walletConnectWallet],
    },
  ];
}

export const wagmiConfig = createConfig({
  chains: [sepolia],
  connectors: connectorsForWallets(buildWalletList(), {
    appName: APP_NAME,
    appDescription:
      "Confidential payroll streaming on Nox — one public aggregate stream, private per-employee salaries.",
    // RainbowKit's type requires the field. Connectors that actually use it are
    // excluded above when it is empty, so nothing ever pairs with a bogus id.
    projectId: walletConnectProjectId ?? "",
  }),
  transports: {
    [sepolia.id]: http(env.sepoliaRpcUrl),
  },
  ssr: false,
});

export const targetChain = sepolia;

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
