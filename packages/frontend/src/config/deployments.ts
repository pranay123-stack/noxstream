import type { DeploymentRecord } from "@shared/types";
import { SEPOLIA_CHAIN_ID, TARGET_NETWORK } from "@shared/nox";
import { env } from "./env";

/**
 * Where the deployed contract addresses come from.
 *
 * There is exactly one rule here: **we never invent an address**. If the deploy
 * script has not run, the app says so and every write button is disabled. A
 * plausible-looking placeholder would be worse than an empty state, because it
 * would produce reverts that look like our bugs.
 *
 * Three sources, highest priority first:
 *   1. `VITE_*_ADDRESS` env vars — for a deploy made minutes ago.
 *   2. `packages/shared/src/deployments/*.json` or
 *      `packages/shared/deployments/*.json` — what the deploy script writes,
 *      shaped as `DeploymentRecord` (packages/shared/src/types.ts). Both
 *      locations are globbed so the frontend does not care which the deploy
 *      script picks.
 *   3. `packages/frontend/deployments/*.json` — a local drop-in of the same
 *      shape, so the frontend can be pointed at a deployment without editing
 *      another package.
 *
 * INTEGRATION NOTE: the deploy script owns (2). Every directory is globbed
 * eagerly, so committing the file is all that is required — no code change.
 */

type JsonModule = { default?: unknown } | unknown;

const sharedRecords: Record<string, JsonModule> = {
  ...import.meta.glob<JsonModule>("../../../shared/src/deployments/*.json", {
    eager: true,
  }),
  ...import.meta.glob<JsonModule>("../../../shared/deployments/*.json", {
    eager: true,
  }),
};
const localRecords = import.meta.glob<JsonModule>("../../deployments/*.json", {
  eager: true,
});

export type DeploymentSource = "env" | "shared" | "local";

export interface DeploymentState {
  /** The active record, or null when nothing usable was found. */
  record: DeploymentRecord | null;
  source: DeploymentSource | null;
  /** Human-readable reasons a candidate was rejected. Surfaced in the UI. */
  problems: string[];
  /** Every file we looked at, for the "not deployed yet" panel. */
  searched: string[];
  /** Shape-reference files skipped on purpose (`*.example.json`). */
  ignored: string[];
}

const ADDRESS_KEYS = [
  "payrollRegistry",
  "noxStreamPayroll",
  "confidentialPayoutToken",
  "streamAdapter",
  "payoutAsset",
] as const;

function isAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function isZeroAddress(value: string): boolean {
  return /^0x0{40}$/i.test(value);
}

/**
 * `packages/shared/src/deployments/sepolia.example.json` is a shape reference
 * whose addresses are all zero, on purpose. Loading it would be exactly the
 * failure this module exists to prevent — an app that looks deployed and points
 * at nothing — so example files are skipped by name, and zero addresses are
 * rejected outright in case one ever arrives under a different name.
 */
function isExampleFile(path: string): boolean {
  return /\.(example|sample|template)\.json$/i.test(path);
}

function unwrap(mod: JsonModule): unknown {
  if (mod && typeof mod === "object" && "default" in mod) {
    return (mod as { default: unknown }).default;
  }
  return mod;
}

function parseRecord(
  raw: unknown,
  origin: string,
  problems: string[],
): DeploymentRecord | null {
  if (!raw || typeof raw !== "object") {
    problems.push(`${origin}: not a JSON object`);
    return null;
  }
  const candidate = raw as Partial<DeploymentRecord>;

  if (candidate.chainId !== SEPOLIA_CHAIN_ID) {
    problems.push(
      `${origin}: chainId ${String(candidate.chainId)} is not ${SEPOLIA_CHAIN_ID} (${TARGET_NETWORK.name})`,
    );
    return null;
  }

  const contracts = candidate.contracts;
  if (!contracts || typeof contracts !== "object") {
    problems.push(`${origin}: missing "contracts" block`);
    return null;
  }
  for (const key of ADDRESS_KEYS) {
    const value = (contracts as Record<string, unknown>)[key];
    if (!isAddress(value)) {
      problems.push(`${origin}: contracts.${key} is not an address`);
      return null;
    }
    if (isZeroAddress(value)) {
      problems.push(
        `${origin}: contracts.${key} is the zero address — this is a placeholder, not a deployment`,
      );
      return null;
    }
  }
  return candidate as DeploymentRecord;
}

function fromEnv(problems: string[]): DeploymentRecord | null {
  const o = env.addressOverrides;
  const present = ADDRESS_KEYS.filter((k) => o[k] !== undefined);
  if (present.length === 0) return null;
  if (present.length !== ADDRESS_KEYS.length) {
    problems.push(
      `env: partial address override — missing ${ADDRESS_KEYS.filter((k) => !o[k]).join(", ")}`,
    );
    return null;
  }
  return {
    chainId: SEPOLIA_CHAIN_ID,
    deployedAt: "(supplied via environment variables)",
    deployer: "0x0000000000000000000000000000000000000000",
    contracts: {
      payrollRegistry: o.payrollRegistry!,
      noxStreamPayroll: o.noxStreamPayroll!,
      confidentialPayoutToken: o.confidentialPayoutToken!,
      streamAdapter: o.streamAdapter!,
      payoutAsset: o.payoutAsset!,
    },
    nox: {
      noxComputeAddress: TARGET_NETWORK.noxComputeAddress,
      handleGatewayUrl: TARGET_NETWORK.handleGatewayUrl,
    },
    streamProtocol: "(unknown — read protocolTag() on-chain)",
    txHashes: {},
  };
}

function tidy(path: string): string {
  return path.replace(/^(\.\.\/)+/, "packages/");
}

function resolve(): DeploymentState {
  const problems: string[] = [];
  const ignored: string[] = [];
  const searched: string[] = [];

  const candidates: Array<[DeploymentSource, string, JsonModule]> = [
    ...Object.entries(sharedRecords).map(
      ([path, mod]) => ["shared", path, mod] as [DeploymentSource, string, JsonModule],
    ),
    ...Object.entries(localRecords).map(
      ([path, mod]) => ["local", path, mod] as [DeploymentSource, string, JsonModule],
    ),
  ];

  const envRecord = fromEnv(problems);
  if (envRecord) {
    return { record: envRecord, source: "env", problems, searched, ignored };
  }

  for (const [source, path, mod] of candidates) {
    if (isExampleFile(path)) {
      ignored.push(tidy(path));
      continue;
    }
    searched.push(tidy(path));
    const parsed = parseRecord(unwrap(mod), tidy(path), problems);
    if (parsed) return { record: parsed, source, problems, searched, ignored };
  }

  return { record: null, source: null, problems, searched, ignored };
}

export const deployment: DeploymentState = resolve();

/** Convenience accessor. `null` whenever the app is in its undeployed state. */
export const addresses = deployment.record?.contracts ?? null;

export const DEPLOYMENT_SEARCH_PATHS = [
  "packages/shared/src/deployments/*.json",
  "packages/shared/deployments/*.json",
  "packages/frontend/deployments/*.json",
] as const;
