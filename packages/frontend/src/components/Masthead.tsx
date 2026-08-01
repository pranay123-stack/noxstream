import { ConnectButton } from "@rainbow-me/rainbowkit";
import { TARGET_NETWORK } from "@shared/nox";
import { deployment } from "@/config/deployments";
import { shortAddress } from "@/nox/handle";
import { Badge, Button, Dot } from "./ui";
import { ExternalIcon } from "./icons";

/**
 * Two zones: identity, and live context + wallet.
 *
 * The centre used to hold the public/private switch. With that gone, a
 * three-column grid would leave a visible dead gap across the middle, so the
 * header is a plain flex row. The space the switch vacated is spent on
 * something a judge can verify instead of a control they have to operate: the
 * registry address this build is actually reading, linked to Etherscan.
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

        <div className="masthead-end">
          <DeploymentChip />
          <AccountButton />
        </div>
      </div>
    </header>
  );
}

/**
 * Real addresses or nothing. When no deployment record is present the chip says
 * so rather than rendering a plausible-looking address.
 */
function DeploymentChip() {
  const registry = deployment.record?.contracts.payrollRegistry;

  if (!registry) {
    return (
      <span className="masthead-chip">
        <span className="faint">no deployment record</span>
      </span>
    );
  }

  return (
    <a
      className="masthead-chip"
      href={`${TARGET_NETWORK.explorer}/address/${registry}`}
      target="_blank"
      rel="noreferrer noopener"
      title="The NoxPayrollRegistry this build reads from"
    >
      <Dot pulse />
      <span>
        Live on {TARGET_NETWORK.name} · registry{" "}
        <span className="mono">{shortAddress(registry, 4)}</span>
      </span>
      <ExternalIcon size={11} />
    </a>
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
