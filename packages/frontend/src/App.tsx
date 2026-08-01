import { useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { TARGET_NETWORK } from "@shared/nox";
import { HowItWorks } from "@/components/HowItWorks";
import { Masthead } from "@/components/Masthead";
import { NotDeployed } from "@/components/NotDeployed";
import { Badge, Button, Callout } from "@/components/ui";
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
        <section className="hero">
          <span className="eyebrow">
            Nox confidential compute · Ethereum Sepolia
          </span>
          <h1>Payroll that streams in public and pays in private.</h1>
          <p className="hero-lede">
            A company funds one ordinary Sablier stream in the open. What each
            person inside it earns is encrypted — the chain stores a pointer,
            not an amount, and only the people you allow can read it.
          </p>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <Badge>
              <StreamIcon size={11} /> company total: public
            </Badge>
            <Badge>
              <EyeIcon size={11} /> who is employed: public
            </Badge>
            <Badge tone="cipher">
              <LockIcon size={11} /> what each person earns: encrypted
            </Badge>
          </div>
        </section>

        <HowItWorks />

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
                <div className="row" style={{ gap: 14 }}>
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
                  <span className="small muted">
                    {role === "employer"
                      ? "What the company sees — and what the public sees instead."
                      : "What one employee sees about their own pay."}
                  </span>
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

/**
 * A slim strip, not a card. Everything below it is genuinely readable without a
 * wallet — which is the demonstration — so this should inform, not gate. A card
 * here reads as a blocker and pushes the actual product below the fold.
 */
function ConnectPrompt() {
  return (
    <div className="notice">
      <LockIcon size={13} />
      <span className="small">
        You are looking at live Sepolia data with{" "}
        <strong>no wallet connected</strong> — which is exactly the observer's
        view. Connect one and any value you were granted access to becomes a
        number.
        {!hasWalletConnect && (
          <span className="faint"> Browser-extension wallets only in this build.</span>
        )}
      </span>
    </div>
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
      <p className="tiny faint">
        Nox access-control contract{" "}
        <span className="mono">{TARGET_NETWORK.noxComputeAddress}</span> · handle
        gateway <span className="mono">{TARGET_NETWORK.handleGatewayUrl}</span>
      </p>
    </footer>
  );
}
