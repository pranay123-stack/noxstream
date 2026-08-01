import { useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { TARGET_NETWORK, isZeroHandle } from "@shared/nox";
import { HandleChip } from "@/components/HandleChip";
import { Masthead } from "@/components/Masthead";
import { NotDeployed } from "@/components/NotDeployed";
import { Badge, Button, Callout } from "@/components/ui";
import {
  ArrowRightIcon,
  EyeIcon,
  LockIcon,
  StreamIcon,
  UnlockIcon,
} from "@/components/icons";
import { deployment } from "@/config/deployments";
import { hasWalletConnect, targetChain } from "@/config/wagmi";
import { useProtocol } from "@/hooks/useProtocol";
import { useRoster } from "@/hooks/useRoster";
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
            One ordinary Sablier stream funds the company in the open; every
            salary inside it exists on-chain only as a 32-byte encrypted handle.
          </p>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
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
          <HeroProof />
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

/**
 * The whole idea in one line, using a REAL handle read from
 * `NoxPayrollRegistry.ratePerSecondOf` on Sepolia — not a sample. If the roster
 * is empty there is nothing honest to show, so the strip does not render;
 * inventing a handle here would undercut the one claim the app is making.
 */
function HeroProof() {
  const roster = useRoster();
  const sample = roster.rows.find(
    (row) => row.rateHandle && !isZeroHandle(row.rateHandle),
  );
  if (!sample?.rateHandle) return null;

  return (
    <div className="heroproof">
      <span className="eyebrow">
        One employee&apos;s salary, exactly as Sepolia stores it
      </span>
      <div className="heroproof-row">
        <HandleChip handle={sample.rateHandle} />
        <ArrowRightIcon size={14} className="cvalue-arrow" />
        <span className="heroproof-out">
          <UnlockIcon size={12} />a real number — but only for an account
          NoxCompute authorised
        </span>
      </div>
      <span className="tiny faint">
        Read live from <span className="mono">ratePerSecondOf()</span>. Scroll
        down and the roster shows the same thing per row: the handle every
        observer gets, next to the plaintext only a grant-holder can obtain.
      </span>
    </div>
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
        Read-only right now. Everything below is public chain data —{" "}
        <strong>no wallet needed to see it</strong>. Connect one to decrypt the
        rows you have been granted access to.
        {!hasWalletConnect && (
          <span className="faint">
            {" "}
            Browser-extension wallets only in this build; set{" "}
            <span className="mono tiny">VITE_WALLETCONNECT_PROJECT_ID</span> for QR
            pairing.
          </span>
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
      <p className="tiny faint mono">
        NoxCompute {TARGET_NETWORK.noxComputeAddress} · gateway{" "}
        {TARGET_NETWORK.handleGatewayUrl}
      </p>
    </footer>
  );
}
