/**
 * Environment plumbing shared by the deploy script and the Sepolia e2e test.
 *
 * Hardhat 3 does NOT auto-load `.env` (unlike Hardhat 2 + `dotenv` in the
 * config). `hardhat.config.ts` therefore does `import "dotenv/config"` at the
 * top, which makes `configVariable("SEPOLIA_RPC_URL")` resolvable. This module
 * loads it a second time (idempotently) so that anything importing it directly
 * — e.g. a test file — sees the same values even if the config was not read.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

/** `packages/contracts` — the Hardhat project root. */
export const CONTRACTS_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

/** Repo root — three levels up from `packages/contracts/scripts/lib`. */
export const REPO_ROOT = path.resolve(CONTRACTS_ROOT, "..", "..");

/** Where the deploy script writes the record the frontend and tests read. */
export const DEPLOYMENTS_DIR = path.join(
  REPO_ROOT,
  "packages",
  "shared",
  "src",
  "deployments",
);

let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  const envPath = path.join(CONTRACTS_ROOT, ".env");
  if (existsSync(envPath)) {
    dotenv.config({ path: envPath, quiet: true });
  }
}

/** A private key that is present, well-formed, and not the all-zero placeholder. */
export function readPrivateKey(name: string): `0x${string}` | undefined {
  loadEnv();
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw === "") return undefined;
  const withPrefix = (raw.startsWith("0x") ? raw : `0x${raw}`).toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(withPrefix)) return undefined;
  // `.env.example` ships an all-zero key as a placeholder; treat it as absent
  // rather than letting it fail deep inside viem with an opaque error.
  if (/^0x0+$/.test(withPrefix)) return undefined;
  return withPrefix as `0x${string}`;
}

export function readString(name: string): string | undefined {
  loadEnv();
  const raw = process.env[name]?.trim();
  return raw === undefined || raw === "" ? undefined : raw;
}

export function readAddress(name: string): `0x${string}` | undefined {
  const raw = readString(name);
  if (raw === undefined) return undefined;
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) {
    throw new Error(`${name} is set but is not a valid address: ${raw}`);
  }
  return raw.toLowerCase() as `0x${string}`;
}

/**
 * Everything the Sepolia path needs. Returns `missing` rather than throwing so
 * callers can report *precisely* what is absent instead of dying on the first
 * gap — a funded key is the one thing we cannot fabricate.
 */
export interface SepoliaEnv {
  rpcUrl?: string;
  deployerKey?: `0x${string}`;
  employeeKey?: `0x${string}`;
  /** Real USDC (or any ERC-20) to use as the payout asset instead of MockUSDC. */
  payoutAsset?: `0x${string}`;
  missing: string[];
}

export function readSepoliaEnv(
  opts: { requireEmployee?: boolean } = {},
): SepoliaEnv {
  loadEnv();
  const rpcUrl = readString("SEPOLIA_RPC_URL");
  const deployerKey = readPrivateKey("DEPLOYER_PRIVATE_KEY");
  const employeeKey = readPrivateKey("EMPLOYEE_PRIVATE_KEY");
  const payoutAsset = readAddress("PAYOUT_ASSET_ADDRESS");

  const missing: string[] = [];
  if (rpcUrl === undefined) missing.push("SEPOLIA_RPC_URL");
  if (deployerKey === undefined) missing.push("DEPLOYER_PRIVATE_KEY");
  if (opts.requireEmployee === true && employeeKey === undefined) {
    missing.push("EMPLOYEE_PRIVATE_KEY");
  }

  return { rpcUrl, deployerKey, employeeKey, payoutAsset, missing };
}
