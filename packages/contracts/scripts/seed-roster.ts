/**
 * Seeds the live roster with additional encrypted allocations.
 *
 * Why this exists: NoxStream's central claim is only *visible* when the roster
 * holds rows the connected account cannot read. With a single employee on the
 * roster, an employee session decrypts its own row and there is nothing to
 * contrast it against — the demo shows a number, not a proof.
 *
 * This adds colleagues whose private keys NOBODY holds. They are generated here
 * and deliberately discarded, so their salaries are permanently undecryptable by
 * anyone except the employer (who, by design, retains an audit grant). That is
 * not a staging trick: those rows are exactly as opaque to us as they are to a
 * judge, which is the point.
 *
 *   npx hardhat run scripts/seed-roster.ts --network sepolia
 */

import { network } from "hardhat";
import { nox } from "@iexec-nox/nox-hardhat-plugin";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";

const RECORD = fileURLToPath(
  new URL("../../shared/src/deployments/sepolia.json", import.meta.url),
);

/** Monthly gross in mUSDC base units (6 dp), converted to a per-second rate. */
const SECONDS_PER_MONTH = 30n * 24n * 60n * 60n;

const COLLEAGUES: Array<{ label: string; monthly: bigint }> = [
  { label: "colleague A", monthly: 8_200_000_000n }, // 8,200.00 / month
  { label: "colleague B", monthly: 3_450_000_000n }, // 3,450.00 / month
];

const REGISTRY_ABI = [
  {
    type: "function",
    name: "setAllocation",
    stateMutability: "nonpayable",
    inputs: [
      { name: "employee", type: "address" },
      { name: "encryptedRate", type: "bytes32" },
      { name: "inputProof", type: "bytes" },
    ],
    outputs: [{ name: "rate", type: "bytes32" }],
  },
  {
    type: "function",
    name: "employeeCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "isRegistered",
    stateMutability: "view",
    inputs: [{ name: "employee", type: "address" }],
    outputs: [{ type: "bool" }],
  },
] as const;

const record = JSON.parse(readFileSync(RECORD, "utf8")) as {
  contracts: { payrollRegistry: Address };
};
const registry = record.contracts.payrollRegistry;

const connection = await network.connect({ network: "sepolia" });
const noxClient = await nox.connect(connection);
const { viem } = connection;
const publicClient = await viem.getPublicClient();
const [wallet] = await viem.getWalletClients();

console.log(`registry ${registry}`);
console.log(`employer ${wallet.account.address}`);
console.log(
  `roster before: ${await publicClient.readContract({
    address: registry,
    abi: REGISTRY_ABI,
    functionName: "employeeCount",
  })}`,
);

for (const { label, monthly } of COLLEAGUES) {
  // Key generated and immediately dropped — see the header comment.
  const address = privateKeyToAccount(generatePrivateKey()).address;
  const ratePerSecond = monthly / SECONDS_PER_MONTH;

  const enc = await noxClient.encryptInput(ratePerSecond, "uint256", registry);
  const hash = (await wallet.writeContract({
    address: registry,
    abi: REGISTRY_ABI,
    functionName: "setAllocation",
    args: [address, enc.handle as Hex, enc.handleProof as Hex],
  })) as Hex;
  await publicClient.waitForTransactionReceipt({ hash });

  console.log(
    `  ${label} ${address} rate=${ratePerSecond}/s handle=${enc.handle} tx=${hash}`,
  );
}

console.log(
  `roster after: ${await publicClient.readContract({
    address: registry,
    abi: REGISTRY_ABI,
    functionName: "employeeCount",
  })}`,
);
console.log("done — no key was retained for either colleague.");

await connection.close();
