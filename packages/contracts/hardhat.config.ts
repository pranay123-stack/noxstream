// Hardhat 3 does NOT read `.env` on its own, and `configVariable(...)` resolves
// from `process.env`. Without this import, `--network sepolia` fails with
// "SEPOLIA_RPC_URL is not set" even when packages/contracts/.env defines it.
import "dotenv/config";

import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";
import noxPlugin from "@iexec-nox/nox-hardhat-plugin";

/**
 * Nox on Ethereum Sepolia. These two values tell the Nox Hardhat plugin to talk
 * to the *live* Nox stack instead of booting the local Docker one. Verified on
 * chain / over HTTP — see packages/shared/src/nox.ts for provenance.
 */
const SEPOLIA_NOX = {
  noxComputeAddress:
    "0x24Ef36Ec5b626D7DCD09a98F3083c2758F0F77bF" as `0x${string}`,
  handleGatewayUrl: "https://gateway-testnets.noxprotocol.dev",
};

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin, noxPlugin],
  solidity: {
    version: "0.8.35",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // Confidential accounting touches many handles per call; via-IR keeps
      // the claim path under the stack-too-deep limit.
      viaIR: true,
    },
  },
  networks: {
    // Local: the Nox plugin boots the offchain stack in Docker on demand.
    default: {
      type: "edr-simulated",
      chainType: "op",
      chainId: 31337,
    },
    sepolia: {
      type: "http",
      chainType: "l1",
      url: configVariable("SEPOLIA_RPC_URL"),
      accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
      chainId: 11155111,
      // Plugin reads this to skip local-stack setup and use the live stack.
      nox: SEPOLIA_NOX,
    },
  },
});
