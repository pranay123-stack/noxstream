import { ConnectButton } from "@rainbow-me/rainbowkit";
import { TARGET_NETWORK } from "@shared/nox";
import { shortAddress } from "@/nox/handle";
import { Badge, Button, Dot } from "./ui";
import { ViewSwitch } from "./ViewSwitch";

/**
 * Three zones: identity, the switch, the wallet.
 *
 * The switch sits in the CENTRE rather than bundled against the wallet button.
 * It is the product's whole argument — the same chain state rendered two ways —
 * so it takes the optical centre instead of competing for a corner, and the
 * header stops having a dead gap across the middle on wide screens.
 */
export function Masthead() {
  return (
    <header className="masthead">
      <div className="masthead-inner">
        <div className="brand">
          <span className="brand-mark">NX</span>
          <span className="brand-text">
            <span className="brand-name">NoxStream</span>
            <span className="brand-sub">Confidential payroll</span>
          </span>
        </div>

        <div className="masthead-center">
          <ViewSwitch />
        </div>

        <div className="masthead-end">
          <AccountButton />
        </div>
      </div>
    </header>
  );
}

function AccountButton() {
  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        openAccountModal,
        openChainModal,
        openConnectModal,
        mounted,
      }) => {
        if (!mounted) {
          return (
            <Button variant="ghost" disabled>
              Loading…
            </Button>
          );
        }
        if (!account || !chain) {
          return (
            <Button variant="primary" onClick={openConnectModal}>
              Connect wallet
            </Button>
          );
        }
        if (chain.unsupported || chain.id !== TARGET_NETWORK.chainId) {
          return (
            <Button variant="danger" onClick={openChainModal}>
              <Dot />
              Switch to {TARGET_NETWORK.name}
            </Button>
          );
        }
        return (
          <button className="btn" onClick={openAccountModal}>
            <Badge tone="plain">
              <Dot />
              Sepolia
            </Badge>
            <span className="mono small">{shortAddress(account.address, 4)}</span>
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}
