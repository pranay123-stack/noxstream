/**
 * SablierStreamAdapter against REAL, UNMODIFIED Sablier — on a Sepolia fork.
 *
 *   npm run test:fork          (from packages/contracts)
 *
 * The value of this file: it exercises the actual deployed Sablier Lockup v4.0
 * bytecode at 0xe61cb9153356419bdaD0A8767c059f92d221a3C4 without needing a
 * funded key, so it runs in CI and is reproducible by anyone. It is the
 * evidence that NoxStream composes with the live protocol rather than with a
 * convenient reimplementation of it.
 *
 * It covers exactly the things a mock cannot:
 *   - Sablier's own accounting agrees with `withdrawableAmount()`
 *   - Sablier records the adapter as sender, recipient and NFT owner
 *   - the stream really is non-cancelable and non-transferable
 *   - the native-token withdrawal fee Sablier v3.0+ charges is real, and a dry
 *     fee tank makes `harvest()` revert (the failure most likely to ruin a demo)
 *   - the permissionless-harvest drain guard holds against a stranger
 *
 * It does NOT touch Nox: the plugin's local stack only supports chain id 31337
 * and this fork runs as 11155111. The confidential half is covered by
 * `test/unit/payroll.test.ts` (real Nox stack) and
 * `test/integration/e2e-sepolia.test.ts` (real Nox on real Sepolia).
 *
 * Two gotchas are encoded below, both discovered the hard way:
 *   1. `chainType` must be TOP-LEVEL in `network.connect(...)`, not inside
 *      `override` — putting it in `override` is silently ignored.
 *   2. Not every Sepolia RPC serves EDR's forking client. publicnode returns
 *      403; `https://sepolia.drpc.org` works for both plain RPC and forking.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { network } from "hardhat";
import type { Address, Hex } from "viem";

/** Real Sablier Lockup v4.0 on Ethereum Sepolia — see docs/STREAM_PROTOCOL.md. */
const LOCKUP: Address = "0xe61cb9153356419bdaD0A8767c059f92d221a3C4";
const FORK_RPC = process.env.FORK_RPC ?? "https://sepolia.drpc.org";

const TOTAL = 3_000_000n; // 3.00 USDC at 6 decimals
const DURATION = 3600; // 1 hour

const TIMEOUT = 600_000;

/** The subset of Sablier's own interface this test reads back from. */
const LOCKUP_ABI = [
  { type: "function", name: "getRecipient", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "getSender", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "getDepositedAmount", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint128" }] },
  { type: "function", name: "getUnderlyingToken", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "isCancelable", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "isTransferable", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
] as const;

describe("SablierStreamAdapter on a Sepolia fork (real Sablier)", { timeout: TIMEOUT }, () => {
  let connection: Awaited<ReturnType<typeof network.connect>>;
  let viem: (typeof connection)["viem"];
  let publicClient: Awaited<ReturnType<(typeof viem)["getPublicClient"]>>;
  let treasury: Awaited<ReturnType<(typeof viem)["getWalletClients"]>>[number];
  let stranger: Awaited<ReturnType<(typeof viem)["getWalletClients"]>>[number];
  let vault: Address;

  before(async () => {
    try {
      connection = await network.connect({
        network: "default",
        // Top-level, NOT inside `override` — inside it is silently ignored.
        chainType: "l1",
        override: {
          // `type` is fixed by the base network entry (edr-simulated) and is
          // not part of NetworkConfigOverride; only these two are overridable.
          chainId: 11155111,
          forking: { url: FORK_RPC },
        },
      });
    } catch (error) {
      throw new Error(
        `Could not fork Sepolia from ${FORK_RPC}: ${String(error)}\n` +
          `Set FORK_RPC to an endpoint that serves eth_getProof / archive reads. ` +
          `publicnode returns 403 to EDR's forking client; sepolia.drpc.org works.`,
      );
    }

    viem = connection.viem;
    publicClient = await viem.getPublicClient();
    const wallets = await viem.getWalletClients();
    treasury = wallets[0];
    // A plain EOA stands in for the confidential vault here; this file is about
    // the public streaming half only.
    vault = wallets[1].account.address;
    stranger = wallets[2];
  });

  it("forks a chain that really contains the deployed Sablier Lockup", async () => {
    const code = await publicClient.getCode({ address: LOCKUP });
    assert.ok(
      code !== undefined && code !== "0x",
      `No bytecode at ${LOCKUP} on the fork — the fork did not take, or ` +
        `${FORK_RPC} is not serving Sepolia state.`,
    );
    const size = (code.length - 2) / 2;
    assert.ok(
      size > 20_000,
      `Only ${size} bytes at ${LOCKUP}; expected Sablier's ~24kB runtime.`,
    );
    console.log(
      `      forked head ${await publicClient.getBlockNumber()}, Sablier runtime ${size} bytes`,
    );
  });

  it("opens a real Sablier stream that Sablier itself reports correctly", async () => {
    const usdc = await viem.deployContract("MockUSDC");
    await usdc.write.mint([treasury.account.address, TOTAL]);

    const adapter = await viem.deployContract(
      "SablierStreamAdapter",
      [LOCKUP, usdc.address, treasury.account.address, vault],
      { value: 10n ** 16n }, // seed the fee tank
    );
    assert.equal(await adapter.read.protocolTag(), "sablier-lockup-linear-v4.0");

    await usdc.write.approve([adapter.address, TOTAL]);
    await publicClient.waitForTransactionReceipt({
      hash: await adapter.write.fundStream([TOTAL, DURATION]),
    });

    const streamId = (await adapter.read.streamId()) as bigint;
    assert.notEqual(streamId, 0n, "no stream id was recorded");

    const ask = <T>(functionName: string) =>
      publicClient.readContract({
        address: LOCKUP,
        abi: LOCKUP_ABI,
        functionName: functionName as never,
        args: [streamId],
      }) as Promise<T>;

    // Read the facts back from Sablier, not from our own adapter.
    assert.equal(
      (await ask<Address>("getSender")).toLowerCase(),
      adapter.address.toLowerCase(),
      "the adapter must be Sablier's sender, so no EOA holds cancel authority",
    );
    assert.equal(
      (await ask<Address>("getRecipient")).toLowerCase(),
      adapter.address.toLowerCase(),
      "the adapter must be the Sablier recipient — Sablier only lets a " +
        "non-owner withdraw TO the recipient, which is what makes " +
        "harvest(address to) expressible at all",
    );
    assert.equal(
      (await ask<Address>("ownerOf")).toLowerCase(),
      adapter.address.toLowerCase(),
    );
    assert.equal(await ask<bigint>("getDepositedAmount"), TOTAL);
    assert.equal(
      (await ask<Address>("getUnderlyingToken")).toLowerCase(),
      usdc.address.toLowerCase(),
    );
    assert.equal(
      await ask<boolean>("isCancelable"),
      false,
      "a cancelable payroll stream would not be a credible commitment",
    );
    assert.equal(await ask<boolean>("isTransferable"), false);
    console.log(`      real Sablier stream id ${streamId}, all fields verified`);
  });

  it("harvests permissionlessly to the vault, and refuses to be drained", async () => {
    const usdc = await viem.deployContract("MockUSDC");
    await usdc.write.mint([treasury.account.address, TOTAL]);
    const adapter = await viem.deployContract(
      "SablierStreamAdapter",
      [LOCKUP, usdc.address, treasury.account.address, vault],
      { value: 10n ** 16n },
    );
    await usdc.write.approve([adapter.address, TOTAL]);
    await adapter.write.fundStream([TOTAL, DURATION]);

    assert.equal(await adapter.read.withdrawableAmount(), 0n);
    await connection.provider.request({
      method: "evm_increaseTime",
      params: ["0x708"], // +1800s = half the term
    });
    await connection.provider.request({ method: "evm_mine", params: [] });

    const half = (await adapter.read.withdrawableAmount()) as bigint;
    assert.ok(
      half > TOTAL / 2n - 10_000n && half <= TOTAL / 2n + 10_000n,
      `expected ~half of ${TOTAL} unlocked, Sablier reports ${half}`,
    );

    // Anyone may push funds toward the vault — employees must not depend on
    // the employer being online.
    const asStranger = await viem.getContractAt(
      "SablierStreamAdapter",
      adapter.address,
      { client: { wallet: stranger } },
    );
    await publicClient.waitForTransactionReceipt({
      hash: await asStranger.write.harvest([vault]),
    });
    const vaultBalance = (await usdc.read.balanceOf([vault])) as bigint;
    assert.ok(vaultBalance > 0n, "the stranger's harvest moved nothing");

    // ...but an unrestricted `to` on a permissionless function would be a
    // drain, so only the vault may redirect.
    await assert.rejects(
      () => asStranger.write.harvest([stranger.account.address]),
      /UnauthorizedDestination/,
      "a stranger was able to redirect harvested payroll to themselves",
    );
    console.log(
      `      stranger harvested ${vaultBalance} to the vault; redirect blocked`,
    );
  });

  it("reverts harvest when the fee tank is dry, and succeeds once seeded", async () => {
    // Sablier v3.0+ charges a native-token fee on EVERY withdrawal, whoever
    // calls it. `IStreamAdapter.harvest` is non-payable (Solidity forbids
    // widening an interface's mutability), so the adapter must hold its own
    // ETH. A dry tank is the failure most likely to ruin a live demo, so it
    // gets an explicit test.
    const usdc = await viem.deployContract("MockUSDC");
    await usdc.write.mint([treasury.account.address, TOTAL]);
    const adapter = await viem.deployContract(
      "SablierStreamAdapter",
      [LOCKUP, usdc.address, treasury.account.address, vault],
      // No `value`: deliberately unfunded.
    );
    assert.equal(await adapter.read.feeTankBalance(), 0n);

    await usdc.write.approve([adapter.address, TOTAL]);
    await adapter.write.fundStream([TOTAL, DURATION]);
    await connection.provider.request({
      method: "evm_increaseTime",
      params: ["0x708"],
    });
    await connection.provider.request({ method: "evm_mine", params: [] });

    const fee = (await adapter.read.minHarvestFeeWei()) as bigint;
    assert.ok(
      fee > 0n,
      "Sablier reports a zero withdrawal fee on this fork; the test would be vacuous",
    );

    await assert.rejects(
      () => adapter.write.harvest([vault]),
      /InsufficientFeeTank/,
      "an unfunded adapter must fail loudly, not silently harvest nothing",
    );

    // `receive()` is open on purpose: if the employer lets the tank run dry, an
    // employee or a bot can refill it and harvest anyway.
    const topUp = fee * 4n;
    await publicClient.waitForTransactionReceipt({
      hash: (await stranger.sendTransaction({
        to: adapter.address,
        value: topUp,
      })) as Hex,
    });
    assert.equal(await adapter.read.feeTankBalance(), topUp);

    await publicClient.waitForTransactionReceipt({
      hash: await adapter.write.harvest([vault]),
    });
    assert.ok(
      ((await usdc.read.balanceOf([vault])) as bigint) > 0n,
      "harvest still moved nothing after the fee tank was topped up",
    );
    console.log(
      `      dry tank reverted; ${topUp} wei from a stranger unblocked the harvest`,
    );
  });

  it("pays out the full deposit by the end of the term and keeps no residue", async () => {
    const usdc = await viem.deployContract("MockUSDC");
    await usdc.write.mint([treasury.account.address, TOTAL]);
    const adapter = await viem.deployContract(
      "SablierStreamAdapter",
      [LOCKUP, usdc.address, treasury.account.address, vault],
      { value: 10n ** 16n },
    );
    await usdc.write.approve([adapter.address, TOTAL]);
    await adapter.write.fundStream([TOTAL, DURATION]);

    const before = (await usdc.read.balanceOf([vault])) as bigint;
    await connection.provider.request({
      method: "evm_increaseTime",
      params: ["0x1c20"], // +7200s, past the end
    });
    await connection.provider.request({ method: "evm_mine", params: [] });
    await publicClient.waitForTransactionReceipt({
      hash: await adapter.write.harvest([vault]),
    });

    assert.equal(
      ((await usdc.read.balanceOf([vault])) as bigint) - before,
      TOTAL,
      "the vault did not receive the whole deposit after the term ended",
    );
    assert.equal(
      await usdc.read.balanceOf([adapter.address]),
      0n,
      "the adapter kept a residue instead of forwarding everything",
    );
    // A no-op harvest must be cheap and quiet — bots will poll this.
    assert.equal(await adapter.read.withdrawableAmount(), 0n);
    await publicClient.waitForTransactionReceipt({
      hash: await adapter.write.harvest([vault]),
    });
  });
});
