import type { ReactNode } from "react";
import { TARGET_NETWORK } from "@shared/nox";
import { DEPLOYMENT_SEARCH_PATHS, deployment } from "@/config/deployments";
import { useGatewayHealth } from "@/hooks/useGatewayHealth";
import { Badge, Callout, Card, CardBody, CardHead, Dot, KeyValue } from "./ui";
import { LockIcon, ShieldIcon, StreamIcon } from "./icons";

/**
 * What a reviewer sees if they clone the repo before the contracts are
 * deployed. It has to do three things honestly: explain the product, prove the
 * app is wired to the real Nox testnet rather than a mock, and say exactly what
 * to run. It never invents an address to look finished.
 */
export function NotDeployed() {
  const health = useGatewayHealth();

  return (
    <div className="stack-lg">
      <Card accent>
        <CardHead
          title="No deployment record found"
          sub="The UI is live and pointed at Ethereum Sepolia — it just has no contracts to talk to yet."
          action={
            <Badge tone="warn">
              <Dot />
              Awaiting deploy
            </Badge>
          }
        />
        <CardBody className="stack">
          <p className="muted">
            NoxStream deliberately refuses to guess. Rather than render a
            plausible-looking address and fail later with reverts that look like
            our bugs, every write path stays disabled until a real{" "}
            <span className="mono small">DeploymentRecord</span> is present.
          </p>

          <div className="stack-sm">
            <span className="eyebrow">Run this</span>
            <code className="cipher-full" style={{ color: "var(--text)" }}>
              cd packages/contracts && npm run deploy:sepolia
            </code>
            <p className="tiny faint">
              The deploy script writes a{" "}
              <span className="mono">DeploymentRecord</span> (see{" "}
              <span className="mono">packages/shared/src/types.ts</span>). This app
              picks it up automatically — no code change, no rebuild step beyond
              the usual dev-server reload.
            </p>
          </div>

          <div className="stack-sm">
            <span className="eyebrow">Looked for it here</span>
            <div className="hairline-list">
              {DEPLOYMENT_SEARCH_PATHS.map((path) => (
                <div className="kv" key={path}>
                  <span className="kv-key mono small">{path}</span>
                  <span className="kv-val faint">no record</span>
                </div>
              ))}
              {deployment.ignored.map((path) => (
                <div className="kv" key={path}>
                  <span className="kv-key mono small">{path}</span>
                  <span className="kv-val faint">
                    skipped — shape reference, all-zero addresses
                  </span>
                </div>
              ))}
            </div>
            <p className="tiny faint">
              Or set the five{" "}
              <span className="mono">VITE_*_ADDRESS</span> variables in{" "}
              <span className="mono">.env.local</span> (see{" "}
              <span className="mono">.env.example</span>) to point at a deployment
              whose record has not been committed yet.
            </p>
          </div>

          {deployment.problems.length > 0 && (
            <Callout tone="warn" title="A candidate record was rejected">
              <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                {deployment.problems.map((problem) => (
                  <li key={problem} className="mono tiny">
                    {problem}
                  </li>
                ))}
              </ul>
            </Callout>
          )}
        </CardBody>
      </Card>

      <div className="grid-2">
        <Card>
          <CardHead
            title="Nox network — live right now"
            sub="Verified against the network, not copied from docs."
          />
          <CardBody>
            <div className="hairline-list">
              <KeyValue k="Chain" v={`${TARGET_NETWORK.name} · ${TARGET_NETWORK.chainId}`} />
              <KeyValue
                k="NoxCompute"
                v={
                  <a
                    className="link"
                    href={`${TARGET_NETWORK.explorer}/address/${TARGET_NETWORK.noxComputeAddress}`}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {TARGET_NETWORK.noxComputeAddress}
                  </a>
                }
              />
              <KeyValue
                k="Handle gateway"
                v={
                  health.isLoading ? (
                    <span className="faint">checking…</span>
                  ) : health.data ? (
                    <span style={{ color: "var(--plain)" }}>
                      {health.data.service} · reachable
                    </span>
                  ) : (
                    <span style={{ color: "var(--danger)" }}>unreachable</span>
                  )
                }
              />
              {health.data && (
                <KeyValue k="Gateway clock" v={health.data.timestamp} />
              )}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHead title="What this app does" />
          <CardBody className="stack-sm">
            <Point icon={<StreamIcon size={15} />} title="One public stream">
              The treasury funds a single ordinary stream. Every protocol that
              composes with it keeps working — the streaming protocol is never
              modified and never even aware of NoxStream.
            </Point>
            <Point icon={<LockIcon size={15} />} title="Private breakdown">
              Each salary lives in Nox as an <span className="mono">euint256</span>{" "}
              handle. Accrual and claims are computed on ciphertext inside the TEE;
              no amount appears on-chain, not even in events.
            </Point>
            <Point icon={<ShieldIcon size={15} />} title="Confidential, not anonymous">
              Roster membership and claim timing stay public, on purpose. We show
              exactly which is which instead of overclaiming.
            </Point>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Point({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="row" style={{ alignItems: "flex-start", gap: 11, flexWrap: "nowrap" }}>
      <span style={{ color: "var(--accent)", marginTop: 2, flex: "none" }}>{icon}</span>
      <span className="stack-sm" style={{ gap: 2 }}>
        <strong className="small">{title}</strong>
        <span className="small muted">{children}</span>
      </span>
    </div>
  );
}
