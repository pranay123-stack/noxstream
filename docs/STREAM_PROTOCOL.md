# Streaming protocol decision: Sablier Lockup v4.0

**Decision: Sablier Lockup, release v4.0, on Ethereum Sepolia (11155111).**
**Both candidates are genuinely live. Sablier wins on interface fit, not on availability.**

Everything below was verified against the live chain on 2026-07-31 (head block
`11389862`) via `https://ethereum-sepolia-rpc.publicnode.com`. No address in this
document or in `SablierStreamAdapter.sol` was taken from a marketing page, and
none is hardcoded in the contract — the adapter takes the Lockup address as a
constructor argument.

---

## 1. Where the addresses came from

Not from docs pages. From each protocol's own machine-readable registry:

| Protocol | Source of truth | Version |
|---|---|---|
| Sablier | npm `sablier` — "Contract addresses, chain data, and deployment information for the Sablier Protocol" | 4.0.0, published 2026-07-30 |
| Superfluid | npm `@superfluid-finance/metadata` → `networks.json`, entry `eth-sepolia` | 1.6.3 |

Sablier ships **six** Lockup releases; three have an Ethereum Sepolia entry, and
all three are live. That is a trap worth naming: "the Sablier Sepolia address"
is ambiguous, and picking the wrong one silently gives you the wrong ABI.

| Release | `SablierLockup` on Sepolia | Deployed at block | `eth_getCode` | `nextStreamId` |
|---|---|---|---|---|
| v2.0 | `0xd116c275541cdBe7594A202bD6AE4DBca4578462` | 7,583,311 | 24,506 bytes | 759 |
| v3.0 | `0x6b0307b4338f2963A62106028E3B074C2c0510DA` | 9,336,998 | 23,157 bytes | 658 |
| **v4.0 (chosen)** | **`0xe61cb9153356419bdaD0A8767c059f92d221a3C4`** | 10,463,080 | 24,481 bytes | 167 |

Supporting v4.0 libraries, also verified non-empty:
`LOCKUP_HELPERS 0xC86B56250D2758f30d09B3420D9ec5b646244C7c` (9,364 bytes),
`LOCKUP_MATH 0x6c873BcE27aA6Ca803EF7013F05d1802AB6995b6` (11,624 bytes).

`nextStreamId > 1` on every one of them means these are not empty deployments —
real users have created 759 / 658 / 167 streams.

## 2. Proving the deployed bytecode matches the ABI we compile against

Version-discriminating `eth_call`s. Each release has functions the others lack,
so behaviour alone pins the version:

| Call | v2.0 | v3.0 | v4.0 |
|---|---|---|---|
| `name()` | `Sablier Lockup NFT` | `Sablier Lockup NFT` | `Sablier Lockup NFT` |
| `symbol()` | `SAB-LOCKUP` | `SAB-LOCKUP` | `SAB-LOCKUP` |
| `MAX_BROKER_FEE()` | `1e17` | **reverts** | **reverts** |
| `comptroller()` | **reverts** | `0x0000008ABbFf7a84a2fE09f9A9b74D3BC2072399` | `0x0000008ABbFf7a84a2fE09f9A9b74D3BC2072399` |
| `nativeToken()` | **reverts** | `0x00…00` | `0x00…00` |
| `calculateMinFeeWei(id)` | **reverts** | `483091068406659` | `483091068406659` |

That is exactly the v2 → v3 ABI break (broker fees removed, comptroller and the
native-token withdrawal fee added), observed on-chain rather than assumed.

Reading a real stream on the chosen v4.0 contract (`streamId 166`):

```
isStream(166)             = true
getSender(166)            = 0xac1AeAc310a377a4703C1C09064a7b00d6bb8A12
getRecipient(166)         = 0x8fe33c237611F0dD418D2EC40F7abB08a90d69D9
getUnderlyingToken(166)   = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
getDepositedAmount(166)   = 10000000
getStartTime(166)         = 1785413532
getEndTime(166)           = 1785427932
streamedAmountOf(166)     = 10000000
withdrawableAmountOf(166) = 10000000
statusOf(166)             = 2   (SETTLED)
ownerOf(166)              = 0x8fe33c237611F0dD418D2EC40F7abB08a90d69D9
calculateMinFeeWei(166)   = 483091068406659
```

**ABI provenance.** The adapter compiles against npm `@sablier/lockup@4.0.1`.
Its shipped artifact ABI was diffed against the `sablier` registry's published
ABI for release v4.0: **68 functions each, function-for-function identical**
(name, inputs, outputs, mutability). So package → registry → deployed bytecode
is a closed chain.

## 3. Replaying the adapter's exact calldata against the live contract

The strongest check available without spending funds: encode precisely what
`SablierStreamAdapter.fundStream` builds and `eth_call` it. A *specific* Sablier
custom error proves the selector and struct encoding land correctly.

| # | Call (against `0xe61c…3C4`) | Result |
|---|---|---|
| 1 | `createWithDurationsLL`, `depositAmount = 0` | reverts `0x1ae0d577` = `SablierLockupHelpers_DepositAmountZero()` |
| 2 | `createWithDurationsLL`, `duration = 0` | reverts `0xa0ffd924` = `SablierLockupHelpers_StartTimeNotLessThanEndTime(uint40,uint40)` |
| 3 | **`createWithDurationsLL` with our real production params** — `shape:"noxstream-aggregate-payroll"`, `granularity:1`, `unlockAmounts:{0,0}`, `durations:{cliff:0,total:2592000}`, `cancelable:false`, `transferable:false`, `depositAmount:1_000_000` — sent from an address holding no tokens | reverts `ERC20: transfer amount exceeds allowance` |

Line 3 is the one that matters: **every Sablier-side validation on our exact
parameters passed**, and execution got all the way to `safeTransferFrom`, which
could only fail because the caller had no allowance. The create path is correct.

Withdrawal semantics, checked on live stream 166 (`withdrawable = 10000000`,
`recipient = 0x8fe3…69D9`), calls made **from an unrelated stranger address**:

| # | Call | Result |
|---|---|---|
| 4 | `withdraw(166, <stranger>, amt)` + fee | reverts `SablierLockup_WithdrawalAddressNotRecipient(166, 0x…DeaDBeef, 0x…DeaDBeef)` |
| 5 | `withdraw(166, <recipient>, amt)` + fee | **succeeds** |
| 6 | `withdraw(166, <recipient>, amt)`, `msg.value = 0` | reverts `SablierLockup_InsufficientFeePayment(0, 483091068406659)` |

Line 5 is the property NoxStream is built on: **a complete stranger can push a
stream's unlocked funds to its recipient.** Permissionless `harvest()` is not
something the adapter fakes — Sablier grants it. Line 4 shows the destination is
constrained to the recipient, which is why the adapter owns the stream NFT
itself (see §6). Line 6 quantifies the fee tank exactly.

## 3b. Full end-to-end run against the real contract (Sepolia fork)

The `eth_call` evidence above proves acceptance; this proves the whole loop. The
adapter was deployed on an EDR fork of Sepolia at block `11389956` — the fork
loads the **real, unmodified SablierLockup v4.0 bytecode** (24,481 bytes, byte-identical
to mainnet-Sepolia state) — and driven through a complete payroll cycle:

```
real SablierLockup code on fork: 24481 bytes
MockUSDC: 0xd351…0210  decimals: 6
adapter:  0xc0da…c1ed  protocolTag: sablier-lockup-linear-v4.0

fundStream(3_000_000, 3600)  gas: 283,963  -> REAL Sablier streamId: 167
  Sablier.getSender      = 0xc0Da…c1ED   (the adapter)
  Sablier.getRecipient   = 0xc0Da…c1ED   (the adapter)
  Sablier.ownerOf        = 0xc0Da…c1ED   (adapter holds the stream NFT)
  Sablier.deposited      = 3000000
  Sablier.token          = 0xD351…0210   (MockUSDC)
  Sablier.isCancelable   = false
  Sablier.isTransferable = false
  minHarvestFeeWei       = 483091068406659

withdrawable @ t0                  = 0
withdrawable @ t+1800 (half term)  = 1521666        (~half of 3000000)
harvest(VAULT) sent BY A STRANGER  -> vault balance = 1522500
harvest(stranger) BY THAT STRANGER -> reverts UnauthorizedDestination
after full term, second harvest    -> vault balance = 3000000  (== full deposit)
adapter residual USDC              = 0
harvest with nothing unlocked      -> returns 0, does not revert
```

Note `streamId: 167` — exactly `nextStreamId` read from the live chain in §1,
confirming the fork is real state and not a fresh chain. Every assertion that
matters is covered: the linear unlock curve is Sablier's own, a third party with
no relationship to the employer successfully paid the vault, the destination
guard blocks the drain, the full principal arrives, and nothing is stranded.

## 4. Superfluid: live, and verified — but the wrong shape

Superfluid on `eth-sepolia` is real. Not disqualified for being fake:

```
host                0x109412E3C84f0539b43d39dB691B08c90f58dC7c   554 bytes (proxy)
  getGovernance()       = 0x9539B21cC67844417E80aE168bc28c831E7Ed271
  getSuperTokenFactory()= 0x254C2e152E8602839D288A7bccdf3d0974597193
  getNow()              = 1785508224
cfaV1               0x6836F23d6171D74Ef62FcF776655aBcD2bcd62Ef   554 bytes
cfaV1Forwarder      0xcfA132E353cB4E398080B9700609bb008eceB125  5672 bytes
  getAccountFlowrate(...) = 0        (responds correctly)
resolver            0x6813edE4E78ecb830d380d0F7F684c12aAc95F02  3238 bytes
superTokenFactory   0x254C2e152E8602839D288A7bccdf3d0974597193   554 bytes
ETHx                0x30a6933Ca9230361972E413a15dC8114c952414e  1444 bytes  symbol=ETHx decimals=18
```

Resolver lookups for a USDC-like SuperToken:

```
resolver.get("supertokens.v1.fUSDCx") = 0xb598E6C621618a9f63788816ffb50Ee2862D443B
  name = "Super fUSDC Fake Token"  symbol = fUSDCx  decimals = 18
  getUnderlyingToken() = 0xe72f289584eDA2bE69Cfe487f4638F09bAc920Db
  getHost()            = 0x109412E3C84f0539b43d39dB691B08c90f58dC7c
resolver.get("tokens.fUSDC")           = 0xe72f289584eDA2bE69Cfe487f4638F09bAc920Db
  name = "fUSDC Fake Token"  symbol = fUSDC  decimals = 18   <-- not 6
resolver.get("supertokens.v1.USDCx")   = 0x0000000000000000000000000000000000000000
```

Four concrete reasons it loses, all mechanical rather than aesthetic:

1. **There is nothing to harvest.** A Superfluid CFA flow *pushes* balance
   continuously to the receiver. `withdrawableAmount()` and `harvest(to)` — the
   heart of `IStreamAdapter` — have no counterpart. Implementing them would mean
   inventing accounting Superfluid does not have, which is precisely the
   "fake numbers" outcome this project is trying to avoid.
2. **No fixed total, no end.** `fundStream(uint256 totalAmount, uint40 duration)`
   describes a closed-ended budget. A CFA flow is an open-ended flowrate; ending
   it after `duration` requires an off-chain keeper or the separate
   `vestingSchedulerV3`. That turns "payroll is funded" into "payroll is funded
   *and* a keeper stayed alive", which is a weaker guarantee than we started with.
3. **The payout asset would have to be a SuperToken.** `asset()` would return
   `fUSDCx`, not a plain ERC-20, so the ERC-7984 confidential wrapper would be
   wrapping a wrapper. And on Sepolia the underlying `fUSDC` is **18 decimals**,
   not USDC's 6 — verified above — so the demo would not even resemble real USDC.
4. **Solvency risk points the wrong way.** CFA flows require the sender to hold a
   buffer deposit and are liquidatable if the sender's SuperToken balance runs
   out. Employees getting paid would depend on the employer staying solvent
   *for the whole term*. Sablier Lockup escrows the full amount up front — the
   money is already gone from the employer's control on day one. For payroll,
   that is the entire point.

Superfluid is the better primitive for open-ended subscriptions. Sablier is the
better primitive for a funded, closed-ended payroll term. `IStreamAdapter` was
written for the latter.

## 5. Why v4.0 and not the fee-free v2.0

v2.0 has no withdrawal fee and would make `harvest()` free. It was still
rejected: it is two releases stale, `@sablier/lockup` on npm now ships v4, and
integrating a superseded ABI to dodge a protocol fee is not a real integration.
v4.0 is the current release and is in active use on Sepolia (167 streams).

The fee is handled honestly instead — see below.

## 6. Consequences baked into `SablierStreamAdapter.sol`

Three properties of the real protocol shaped the adapter. All are documented at
the point of use in the contract:

- **The adapter is the stream's Sablier recipient, not the vault.** Evidence
  line 4: a non-owner may only withdraw *to the recipient*. If the vault owned
  the stream NFT, `harvest(address to)` could never honour an arbitrary `to`.
  Owning the NFT here also means the confidential vault needs no ERC-721
  awareness at all. The economic recipient is still the vault, enforced by the
  destination guard: anyone may harvest **to the vault**; only the vault may
  redirect elsewhere. A permissionless function with a free-form destination
  would simply be a drain.
- **A native-token fee tank.** Evidence line 6: every `withdraw` costs
  `483091068406659` wei on Sepolia today, charged whoever calls it.
  `IStreamAdapter.harvest` is non-payable and Solidity cannot widen an
  interface's mutability, so the adapter holds its own ETH and pays from it.
  `receive()` is open to anyone, so an employee or bot can refill the tank and
  harvest without the employer — the trust-minimised property survives.
  `minHarvestFeeWei()` and `feeTankBalance()` let a UI warn before it bites.
  **Deploy note: the adapter needs ETH or `harvest` reverts.** Its constructor
  is payable so a deploy script can seed it in the same transaction.
- **`cancelable: false`, `transferable: false`.** Once payroll is funded neither
  the employer nor the adapter can claw it back, and the stream NFT cannot leave
  the adapter. Sablier's `sender` role is set to the adapter, which exposes no
  cancel function, so no EOA holds any privileged role over funded payroll.

Sablier itself is untouched. NoxStream opens one ordinary Lockup Linear stream,
tagged `shape: "noxstream-aggregate-payroll"`, that appears in Sablier's own UI,
subgraph and NFT like any other. No fork, no patch, no redeployment.

## 7. Reproducing this

```bash
curl -s -X POST https://ethereum-sepolia-rpc.publicnode.com \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_getCode",
       "params":["0xe61cb9153356419bdaD0A8767c059f92d221a3C4","latest"]}'
```

Registries: `npm pack sablier@4.0.0` (addresses in
`dist/esm/evm/releases/lockup/*/deployments.js`, `abi/lockup/v4.0/`) and
`npm pack @superfluid-finance/metadata@1.6.3` (`networks.json`, `chainId 11155111`).

## 8. Caveats stated plainly

- Sablier's fee is set by a comptroller (`0x0000008ABbFf7a84a2fE09f9A9b74D3BC2072399`)
  and can change. The adapter reads `calculateMinFeeWei` live on every harvest
  rather than caching a constant, so a fee change cannot silently break it — but
  a large increase would need a bigger tank.
- Line 5's success is an `eth_call` simulation against current state, not a
  mined transaction. It proves the contract *accepts* the call; it is not a
  receipt. §3b is a forked execution — real Sablier bytecode and real state, but
  still not a public-testnet receipt. A live Sepolia deployment is the deploy
  step, not something this document claims to have already done.
- `https://ethereum-sepolia-rpc.publicnode.com` serves plain JSON-RPC fine but
  returns **403** to Hardhat's EDR forking client. `https://sepolia.drpc.org`
  works for forking; that is the URL §3b used.
- v2.0/v3.0 Sepolia addresses are listed for provenance only. The adapter is
  built and tested against **v4.0**; pointing it at v2.0 would revert, since
  `calculateMinFeeWei` does not exist there.
