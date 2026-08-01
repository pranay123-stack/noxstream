/**
 * NoxStream deployment.
 *
 *   npx hardhat run scripts/deploy.ts --network sepolia
 *   DRY_RUN=1 npx hardhat run scripts/deploy.ts --network sepolia   # no broadcast
 *
 * Writes a `DeploymentRecord` (packages/shared/src/types.ts) to
 * `packages/shared/src/deployments/<network>.json`. The frontend and the e2e
 * test read that file, so no address is ever hardcoded anywhere downstream.
 *
 * Environment (packages/contracts/.env — see .env.example):
 *   SEPOLIA_RPC_URL          required
 *   DEPLOYER_PRIVATE_KEY     required, must hold Sepolia ETH
 *   PAYOUT_ASSET_ADDRESS     optional; a real ERC-20 to stream instead of MockUSDC
 *   FORCE_REDEPLOY=1         optional; ignore an existing, still-live record
 *   DRY_RUN=1                optional; preflight + plan only, broadcasts nothing
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { globalOptions, network } from "hardhat";
import { formatEther, type Address } from "viem";
import { deployNoxStreamSystem } from "./lib/deploy-system.js";
import {
  DEPLOYMENTS_DIR,
  loadEnv,
  readAddress,
  readPrivateKey,
  readString,
} from "./lib/env.js";

/** Kept structurally identical to `DeploymentRecord` in packages/shared. */
interface DeploymentRecord {
  chainId: number;
  deployedAt: string;
  deployer: Address;
  contracts: {
    payrollRegistry: Address;
    noxStreamPayroll: Address;
    confidentialPayoutToken: Address;
    streamAdapter: Address;
    payoutAsset: Address;
  };
  nox: { noxComputeAddress: Address; handleGatewayUrl: string };
  streamProtocol: string;
  txHashes: Record<string, `0x${string}`>;
}

const FAUCETS = [
  "https://www.alchemy.com/faucets/ethereum-sepolia",
  "https://sepoliafaucet.com",
  "https://faucet.quicknode.com/ethereum/sepolia",
];

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

function banner(title: string): void {
  log(`\n${"─".repeat(72)}\n${title}\n${"─".repeat(72)}`);
}

function fail(lines: string[]): never {
  process.stderr.write(`\n${lines.join("\n")}\n\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  loadEnv();

  // Resolve the target network BEFORE connecting. `network.connect()` eagerly
  // resolves `configVariable("SEPOLIA_RPC_URL")` and dies with a Hardhat stack
  // trace, so the friendly "here is what to put in .env" message has to come
  // first. `hardhat run --network X` surfaces X on `globalOptions`.
  const networkName =
    readString("DEPLOY_NETWORK") ?? globalOptions.network ?? "default";
  const dryRun = readString("DRY_RUN") === "1";

  banner(`NoxStream deploy — network "${networkName}"${dryRun ? " (DRY RUN)" : ""}`);

  // ------------------------------------------------------------------
  // Preflight. Everything that can be checked before spending gas, is.
  // ------------------------------------------------------------------
  if (networkName === "sepolia") {
    const missing: string[] = [];
    if (readString("SEPOLIA_RPC_URL") === undefined) missing.push("SEPOLIA_RPC_URL");
    if (readPrivateKey("DEPLOYER_PRIVATE_KEY") === undefined) {
      missing.push("DEPLOYER_PRIVATE_KEY");
    }
    if (missing.length > 0) {
      fail([
        `Cannot deploy to Sepolia: missing or placeholder ${missing.join(", ")}.`,
        ``,
        `  cp packages/contracts/.env.example packages/contracts/.env`,
        `  # then fill in ${missing.join(" and ")}`,
        ``,
        `DEPLOYER_PRIVATE_KEY must be a real 32-byte key with Sepolia ETH — the`,
        `all-zero placeholder in .env.example counts as absent.`,
        `Faucets:`,
        ...FAUCETS.map((u) => `  - ${u}`),
        ``,
        `Nothing was broadcast.`,
      ]);
    }
  }

  const connection = await network.connect({ network: networkName });
  const { viem } = connection;
  const publicClient = await viem.getPublicClient();
  const walletClients = await viem.getWalletClients();
  if (walletClients.length === 0) {
    fail([
      `Network "${networkName}" exposes no accounts — check DEPLOYER_PRIVATE_KEY.`,
      `Nothing was broadcast.`,
    ]);
  }
  const deployer = walletClients[0].account.address as Address;
  const chainId = await publicClient.getChainId();
  const balance = await publicClient.getBalance({ address: deployer });

  log(`chainId   ${chainId}`);
  log(`deployer  ${deployer}`);
  log(`balance   ${formatEther(balance)} ETH`);

  const isLocal = chainId === 31337;
  if (!isLocal && balance === 0n) {
    fail([
      `Deployer ${deployer} has a zero balance on chain ${chainId}.`,
      `NoxStream's deploy is ~6 transactions; fund it with a little Sepolia ETH first:`,
      ...FAUCETS.map((u) => `  - ${u}`),
      ``,
      `Nothing was broadcast.`,
    ]);
  }
  if (!isLocal && balance < 10_000_000_000_000_000n) {
    log(
      `WARNING: balance is below 0.01 ETH — the deploy may run out of gas partway.`,
    );
  }

  const payoutAsset = readAddress("PAYOUT_ASSET_ADDRESS");
  log(
    payoutAsset === undefined
      ? `payout asset: MockUSDC (will be deployed — a testnet payout asset, not fake data)`
      : `payout asset: ${payoutAsset} (external, supplied via PAYOUT_ASSET_ADDRESS)`,
  );

  // Reuse an existing deployment when it is still live on this chain.
  const recordPath = path.join(DEPLOYMENTS_DIR, `${networkName}.json`);
  const force = readString("FORCE_REDEPLOY") === "1";
  if (!force && existsSync(recordPath)) {
    const existing = JSON.parse(
      readFileSync(recordPath, "utf8"),
    ) as DeploymentRecord;
    if (existing.chainId === chainId) {
      const codes = await Promise.all(
        Object.values(existing.contracts).map((a) =>
          publicClient.getCode({ address: a as Address }),
        ),
      );
      if (codes.every((c) => c !== undefined && c !== "0x")) {
        banner(`Already deployed — reusing ${path.relative(process.cwd(), recordPath)}`);
        for (const [name, address] of Object.entries(existing.contracts)) {
          log(`  ${name.padEnd(26)} ${address}`);
        }
        log(`\nSet FORCE_REDEPLOY=1 to deploy a fresh set.`);
        await connection.close();
        return;
      }
      log(`existing record found but some contracts have no code — redeploying.`);
    }
  }

  if (dryRun) {
    banner(`DRY RUN — preflight passed, nothing broadcast`);
    log(`A real run would deploy, in order:`);
    log(`  1. ${payoutAsset === undefined ? "MockUSDC" : "(reuse " + payoutAsset + ")"}`);
    log(`  2. ConfidentialPayoutToken`);
    log(`  3. <Protocol>StreamAdapter`);
    log(`  4. NoxPayrollRegistry`);
    log(`  5. NoxStreamPayroll`);
    log(`  6. registry.setPayroll(payroll)  <- required, see deploy-system.ts`);
    log(`  7. payroll.start()`);
    log(`\nRecord would be written to ${recordPath}`);
    await connection.close();
    return;
  }

  // ------------------------------------------------------------------
  // Deploy.
  // ------------------------------------------------------------------
  banner(`Deploying`);
  const feeTankEnv = readString("FEE_TANK_WEI");
  const system = await deployNoxStreamSystem(connection, {
    payoutAsset,
    sablierLockup: readAddress("SABLIER_LOCKUP_ADDRESS"),
    // A Sablier test double is permitted only on the ephemeral local chain.
    allowLocalMockLockup: isLocal,
    feeTankWei: feeTankEnv === undefined ? undefined : BigInt(feeTankEnv),
    log,
  });

  // Nox stack coordinates, taken from the plugin (never hardcoded here).
  const { nox } = await import("@iexec-nox/nox-hardhat-plugin");
  const noxClient = await nox.connect(connection);

  const record: DeploymentRecord = {
    chainId: system.chainId,
    deployedAt: new Date().toISOString(),
    deployer: system.deployer,
    contracts: {
      payrollRegistry: system.addresses.payrollRegistry,
      noxStreamPayroll: system.addresses.noxStreamPayroll,
      confidentialPayoutToken: system.addresses.confidentialPayoutToken,
      streamAdapter: system.addresses.streamAdapter,
      payoutAsset: system.addresses.payoutAsset,
    },
    nox: {
      noxComputeAddress: noxClient.noxComputeAddress,
      handleGatewayUrl: noxClient.handleGatewayUrl,
    },
    streamProtocol: system.streamProtocol,
    txHashes: system.txHashes,
  };

  mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");

  banner(`Deployed`);
  for (const [name, address] of Object.entries(record.contracts)) {
    log(`  ${name.padEnd(26)} ${address}`);
  }
  log(`\n  NoxCompute                 ${record.nox.noxComputeAddress}`);
  log(`  Handle gateway             ${record.nox.handleGatewayUrl}`);
  log(`  Stream protocol            ${record.streamProtocol}`);
  log(`  Sablier Lockup             ${system.sablierLockup ?? "n/a"}${system.usedMockLockup ? "  (LOCAL TEST DOUBLE)" : ""}`);
  log(`  Payout asset is a mock     ${system.usedMockPayoutAsset}`);
  log(`\n  Transactions:`);
  for (const [key, hash] of Object.entries(record.txHashes)) {
    log(`    ${key.padEnd(32)} ${hash}`);
  }
  log(`\nRecord written to ${recordPath}`);

  await connection.close();
}

main().catch((error: unknown) => {
  process.stderr.write(`\nDeploy failed: ${String(error)}\n`);
  if (error instanceof Error && error.stack !== undefined) {
    process.stderr.write(`${error.stack}\n`);
  }
  process.exit(1);
});
