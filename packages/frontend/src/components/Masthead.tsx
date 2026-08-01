import { ConnectButton } from "@rainbow-me/rainbowkit";
import { TARGET_NETWORK } from "@shared/nox";
import { shortAddress } from "@/nox/handle";
import { Badge, Button, Dot } from "./ui";
import { ViewSwitch } from "./ViewSwitch";

export function Masthead() {
  return (
    <header className="masthead">
      <div className="masthead-inner">
        <div className="brand">
          <span className="brand-mark">NX</span>
          <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span className="brand-name">NoxStream</span>
            <span className="brand-sub">Confidential payroll streaming</span>
          </span>
        </div>

        <div className="row" style={{ gap: 10 }}>
          <span className="row" style={{ gap: 8 }}>
            <ViewSwitch />
          </span>
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
