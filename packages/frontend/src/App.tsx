import { useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { TARGET_NETWORK } from "@shared/nox";
import { Masthead } from "@/components/Masthead";
import { NotDeployed } from "@/components/NotDeployed";
import { ViewSwitchExplainer } from "@/components/ViewSwitch";
import { Badge, Button, Callout, Card, CardBody } from "@/components/ui";
import { EyeIcon, LockIcon, StreamIcon } from "@/components/icons";
import { deployment } from "@/config/deployments";
import { hasWalletConnect, targetChain } from "@/config/wagmi";
import { useProtocol } from "@/hooks/useProtocol";
import { useHandleClient } from "@/nox/HandleClientProvider";
import { EmployeeView } from "@/views/EmployeeView";
import { EmployerView } from "@/views/EmployerView";

type Role = "employer" | "employee";

export function App() {
  const [role, setRole] = useState<Role>("employer");
  const { isConnected, chainId } = useAccount();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const handleClient = useHandleClient();
  const protocol = useProtocol();

  const wrongNetwork = isConnected && chainId !== TARGET_NETWORK.chainId;

  return (
    <>
      <Masthead />
      <main className="shell">
        <section className="stack" style={{ padding: "34px 0 26px" }}>
          <div className="stack-sm" style={{ maxWidth: 760 }}>
            <span className="eyebrow">
              Nox confidential compute · Ethereum Sepolia
            </span>
            <h1>Payroll that streams in public and pays in private.</h1>
            <p className="muted">
              One ordinary Sablier stream funds the whole company — auditable,
              composable, exactly as before. Every individual salary lives inside
              Nox as an encrypted handle. Same screen, one switch, both truths.
            </p>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <Badge>
              <StreamIcon size={11} /> aggregate total: public
            </Badge>
            <Badge>
              <EyeIcon size={11} /> roster membership: public
            </Badge>
            <Badge tone="cipher">
              <LockIcon size={11} /> every salary: ciphertext
            </Badge>
          </div>
          <ViewSwitchExplainer />
        </section>

        <div className="stack">
          {wrongNetwork && (
            <Callout
              tone="danger"
              title={`Wrong network`}
              action={
                <Button
                  size="sm"
                  variant="primary"
                  loading={isSwitching}
                  onClick={() => switchChain({ chainId: targetChain.id })}
                >
                  Switch to {TARGET_NETWORK.name}
                </Button>
              }
            >
              NoxStream's contracts and the Nox handle gateway both live on{" "}
              {TARGET_NETWORK.name} ({TARGET_NETWORK.chainId}). Handles are bound to
              a chain id, so nothing here can be read or written from another one.
            </Callout>
          )}

          {handleClient.status === "error" && handleClient.error && (
            <Callout tone="danger" title={handleClient.error.title}>
              {handleClient.error.detail}
            </Callout>
          )}

          {deployment.record === null ? (
            <NotDeployed />
          ) : (
            <div className="stack">
              <div className="row-between">
                <div className="tabs" role="tablist" aria-label="Role">
                  <button
                    className="tab"
                    role="tab"
                    aria-selected={role === "employer"}
                    onClick={() => setRole("employer")}
                  >
                    Employer
                  </button>
                  <button
                    className="tab"
                    role="tab"
                    aria-selected={role === "employee"}
                    onClick={() => setRole("employee")}
                  >
                    Employee
                  </button>
                </div>
                <span className="tiny faint mono">
                  {deployment.source === "env"
                    ? "addresses from environment"
                    : `deployed ${deployment.record.deployedAt}`}
                </span>
              </div>

              {!isConnected && <ConnectPrompt />}

              {role === "employer" ? (
                <EmployerView protocol={protocol} />
              ) : (
                <EmployeeView protocol={protocol} />
              )}
            </div>
          )}
        </div>

        <Footer />
      </main>
    </>
  );
}

function ConnectPrompt() {
  return (
    <Card>
      <CardBody className="stack-sm">
        <strong>Connect a wallet to interact</strong>
        <p className="small muted">
          The public view below is readable without one — that is rather the
          point. Decrypting anything requires a signature from an account the
          contract granted access to.
        </p>
        {!hasWalletConnect && (
          <p className="tiny faint">
            WalletConnect is not configured in this build, so QR / mobile pairing
            is unavailable. Browser-extension wallets work normally. Set{" "}
            <span className="mono">VITE_WALLETCONNECT_PROJECT_ID</span> to enable
            the rest.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

function Footer() {
  return (
    <footer
      className="stack-sm"
      style={{ marginTop: 48, paddingTop: 22, borderTop: "1px solid var(--line)" }}
    >
      <p className="tiny faint" style={{ maxWidth: 760 }}>
        Nox provides confidentiality, not anonymity. Individual salaries, accrued
        amounts and claim amounts are encrypted. The aggregate stream, roster
        membership, and the fact that an address claimed at a given time remain
        public — deliberately, and stated here rather than implied away. Claim
        timing is mitigated by epoch batching, not eliminated.
      </p>
      <p className="tiny faint mono">
        NoxCompute {TARGET_NETWORK.noxComputeAddress} · gateway{" "}
        {TARGET_NETWORK.handleGatewayUrl}
      </p>
    </footer>
  );
}
