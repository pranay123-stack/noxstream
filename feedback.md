# Feedback on the iExec Nox tooling

From building [NoxStream](README.md) — confidential payroll streaming — during the
iExec WTF Summer Hackathon, 2026-07-31.

**How hard we pushed on it**, so you can weight the feedback: a four-contract
confidential system (encrypted roster, accrual, clamped confidential claim, ERC-7984
payout token) exercised by 29 unit tests against the local Nox stack in Docker, a
React frontend that encrypts inputs and decrypts handles in the browser, and a live
Sepolia e2e suite. Every finding below was confirmed against shipped source, a live
endpoint, or an error we actually hit — not inferred from docs. The raw evidence is
in [`docs/NOX_NOTES.md`](docs/NOX_NOTES.md); the `[N]` tags cross-reference it.

Versions in play:

```
@iexec-nox/nox-hardhat-plugin         0.2.0
@iexec-nox/nox-protocol-contracts     0.2.4
@iexec-nox/nox-confidential-contracts 0.2.2
@iexec-nox/handle                     0.1.0-beta.13
hardhat 3.12.0 · solc 0.8.35 (optimizer + viaIR) · Node 22 · Ethereum Sepolia 11155111
```

**Sections 1–7 are about Nox. Section 8 is ecosystem friction that is explicitly
*not* yours** — it is separated so you are not handed someone else's bugs.

---

## 1. What genuinely works well

Not padding. These are the things that made a four-contract confidential system
buildable in a hackathon window, and they should not be traded away in a redesign.

- **The `safeAdd`/`safeSub`/`safeMul` + `select` clamp pattern is the right
  primitive, and it is privacy-correct by construction.** Returning `(ebool ok,
  euint256 v)` instead of reverting forces developers into the only design that does
  not leak: a `revert` on an encrypted comparison is a public side channel. In
  NoxStream a reverting over-claim would let anyone binary-search a salary by
  watching which claims succeed. The API makes the safe thing the easy thing, which
  is rare in cryptographic tooling.
- **The local Docker stack in the Hardhat plugin is the single best DX decision in
  the project.** `network.connect({ network: "default" })` on an `edr-simulated`
  network booting the whole offchain stack means every one of our 19 confidential
  tests exercises real encryption, real TEE computation and real ACL enforcement —
  in CI, with no keys, no funds and no testnet flakiness. Being able to assert *"a
  third party's `decrypt` is genuinely refused"* offline is what makes our privacy
  claims testable rather than aspirational.
- **The ERC-7984 implementation is solid and the two-phase asynchronous unwrap is
  modelled honestly.** `UnwrapRequested` → `UnwrapFinalized` correctly reflects that
  turning ciphertext back into a public ERC-20 amount needs an off-chain round-trip,
  rather than pretending it is atomic. `ERC20ToERC7984Wrapper` gave us a fully
  collateralised confidential payout token with no mint authority in ~40 lines
  ([`ConfidentialPayoutToken.sol`](packages/contracts/contracts/ConfidentialPayoutToken.sol)).
- **Appending `.md` to any docs URL returns clean markdown, and `/llms.txt` lists
  every page.** This is excellent and under-advertised. It made the docs greppable
  and diffable against shipped source, which is how most of this file got written.
- **Ethereum Sepolia genuinely works today**, whatever the docs say (see [1]).
  NoxCompute `0x24Ef36Ec5b626D7DCD09a98F3083c2758F0F77bF` has real runtime bytecode,
  the gateway answers HTTP 200, and the subgraph answered a `_meta` query at block
  11,389,792. `createViemHandleClient(walletClient)` auto-resolved chain 11155111 in
  the browser with **no override at all**.
- **`encryptInput` binding a handle to its `applicationContract`** is the right
  default. A handle minted for one contract cannot be replayed against another, and
  we got that property for free rather than having to design it.

---

## 2. The four findings that cost the most time

Ranked by how much time they would save another developer. Each of these took hours,
and each surfaces as an error that points at the wrong place.

### 2.1 The ACL is checked against the *calling contract*, and this is not documented `[7]`

**This is the single costliest thing to learn by trial and error**, and it is the
main reason multi-contract confidential systems are much harder than the
single-contract examples suggest.

A handle's ACL must grant every contract that will **compute** on it, not just the
humans who may decrypt it. In NoxStream, `NoxStreamPayroll.claim()` evaluates
`rate * elapsed` on a handle minted by `NoxPayrollRegistry`. Without an explicit
`Nox.allow(rate, payrollAddress)`:

```
Nox.safeMul(...) reverts NotAllowed   — inside claim(), from a user's transaction,
                                        arbitrarily far from the setAllocation
                                        that actually caused it
```

Everything in the docs and the starter is about *who may decrypt*. Nothing says
*which contracts may compute*. We only found it by elimination.

**Reproduction:** deploy two contracts; have A mint a handle and grant `allowThis` +
`allow(handle, user)`; have B read that handle from A and call `Nox.mul` on it. B
reverts `NotAllowed` even though the user is granted and A is granted.

**Our workaround** is [`INoxPayrollRegistry.setPayroll()`](packages/contracts/contracts/NoxPayrollRegistry.sol),
a deploy step whose sole purpose is to back-fill `Nox.allow(rate, payroll)` across
the whole roster. It is documented at the point of use because nobody would guess it.

**Suggested fixes,** in order of value:
1. A docs page titled something like *"ACLs across multiple contracts"* stating the
   rule in one sentence: **every contract that performs an operation on a handle
   needs its own grant, not only the accounts that may read it.**
2. Make the revert say so. `NotAllowed` could carry `(handle, caller)`; when
   `caller` is a contract, that alone would have saved us hours.
3. Worth stating explicitly in the same page, because it is the natural next
   worry: granting a *contract* is not granting a *person*. Decryption requires an
   EIP-712 signature from the granted address, so a contract with no signing path
   can compute on a value it can never read out. We had to reason that through
   ourselves before we were willing to ship the grant.

### 2.2 Input proofs expire on **wall-clock** time, which silently breaks `evm_increaseTime` `[22]`

The hardest-to-diagnose problem we hit, and it will hit anyone testing a time-based
confidential contract — which is a large fraction of interesting ones.

`NoxCompute` initialises `proofExpirationDuration = 1 hours`, and `Compute.sol`
enforces `block.timestamp <= createdAt + duration`, where `createdAt` is stamped by
the **gateway** from real wall-clock time. Hardhat's `evm_increaseTime` moves the
chain clock but not the gateway's, so **every second of simulated time travel
permanently consumes that budget for every `encryptInput` performed afterwards in
the same process** — not just the next one.

Symptom, after advancing 4 days to test salary accrual:

```
every subsequent setAllocation reverts InvalidProof(..., "Proof expired")
…and viem cannot decode it, so it surfaces as:
  unrecognized custom error 0xae385f38
```

Nothing in the docs connects time travel to encryption. We lost a long time looking
at the ACL, then at the proof encoding, before finding the mismatch between two
clocks.

**Our workaround** is a hard budget with an explanatory failure —
[`test/utils/nox.ts`](packages/contracts/test/utils/nox.ts) tracks cumulative
advancement per connection and refuses to exceed 1,800s of the 3,600s window. Every
test scenario had to be re-scoped from days to minutes.

**Suggested fixes:**
1. Document it. One paragraph on the testing page: *"Nox input proofs expire one
   hour after the gateway mints them, measured in wall-clock time. Chain time travel
   does not move the gateway's clock, so `evm_increaseTime` spends your proof budget."*
2. Make `InvalidProof`'s ABI available to consumers so `0xae385f38` decodes. An
   undecodable custom error is a debugging dead end; the string `"Proof expired"` is
   *already in the revert data* and never reaches the developer.
3. Ideal: let the local Docker stack take its `createdAt` from the chain's
   `block.timestamp` rather than wall-clock. On an ephemeral dev chain there is no
   security argument for wall-clock, and it would make time-based confidential
   contracts testable at all.

### 2.3 `@iexec-nox/handle` signs as one account and identifies as another `[23]`

A genuine SDK bug with a misleading symptom.

`WalletClientAdapter.signTypedData` signs with `walletClient.account`, but
`getAddress()` derives the identity presented to the gateway from
`getAddresses()[0]` — the node's full `eth_accounts` list. For any client whose
provider exposes more than one account (i.e. every Hardhat or Anvil setup), a wallet
client for account **#1** signs as #1 while claiming to be **#0**.

The gateway then answers either:

```
401 invalid signature
```

or, worse:

```
user 0x<account #0> is not authorized to decrypt it
```

— naming an address you never asked about. That is **indistinguishable from a
missing ACL grant**, and it sends you debugging your contract's `Nox.allow` calls
when the contract is correct.

This one is load-bearing for us: proving "only the employee can decrypt their own
salary" *requires* a client bound to a non-default account, so we hit it immediately
and it looked exactly like our ACL was broken.

**Our workaround:** build the handle client on a viem **local** account
(private-key/mnemonic), because viem short-circuits `getAddresses()` for those and
returns only that account. `handleClientFor()` in
[`test/utils/nox.ts`](packages/contracts/test/utils/nox.ts) now asserts
`account.address === getAddresses()[0]` and throws a readable error if they differ,
because the SDK's own message is actively misleading.

**Suggested fix:** in `WalletClientAdapter`, prefer `walletClient.account.address`
when present and fall back to `getAddresses()[0]` only when it is not. One line, and
it removes an entire class of false ACL bugs.

### 2.4 `decrypt()` asks for a signature *before* it checks whether the handle is computable `[16]`

The worst UX in the SDK, and the reason we could not use `decrypt()` directly in the
browser.

`decrypt()` generates the EIP-712 authorisation **first**, then retries the gateway
for roughly 7 seconds (1s / 2s / 4s), and **on failure does not cache the material it
just signed for**. On a shared testnet, where handle resolution routinely takes tens
of seconds, every outer retry therefore pops a *fresh wallet prompt*. A single value
becomes a stream of signature requests, which trains users to reject them.

**Our workaround** is [`src/nox/gateway.ts`](packages/frontend/src/nox/gateway.ts):
poll the unsigned public status endpoint ourselves, then request the signature
exactly once, at the moment the ciphertext is actually retrievable. Combined with an
up-front `isViewer` read (see 4.2), the resulting flow is
`checking-acl → resolving → awaiting-signature → decrypting`, and a user is never
asked to sign for a value they cannot get.

**Suggested fixes:**
1. Check handle status *before* requesting the signature.
2. Cache the authorisation regardless of outcome — it is valid for an hour; throwing
   it away on a transient gateway miss is pure loss.
3. Make the retry budget configurable. `~7s` is tuned for the local stack and is far
   too short for the shared testnet.

---

## 3. Solidity SDK (`nox-protocol-contracts`, `nox-confidential-contracts`)

### 3.1 `confidentialTransfer` returns a handle the caller cannot use `[8]`

Under `_updateWithOptimizedPrimitives`, the returned `transferred` handle receives
**no ACL grants at all**, whereas `_updateWithRawPrimitives` grants `from`, `to` and
`this`. `confidentialTransferFrom` papers over this with
`Nox.allowTransient(transferred, msg.sender)`; plain `confidentialTransfer` does not.

Consequence: a contract that needs to book what actually moved cannot use the return
value — it must track its own pre-clamped amount. We do exactly that, with a comment
explaining why, in [`NoxStreamPayroll.claim()`](packages/contracts/contracts/NoxStreamPayroll.sol).

The asymmetry between the two primitive paths is undocumented and looks like an
oversight. Either grant `msg.sender` in both paths, or document loudly that
`confidentialTransfer`'s return value is not usable by the caller.

### 3.2 `Nox.toEuint256(x)` mints a **public** handle `[9]`

It calls `wrapAsPublicHandle`. Neither the name nor the docs suggest that, and it
means `Nox.allow(...)` on the result is silently a no-op. Anywhere a plaintext
constant is stored as a "confidential" value — a zeroed-out salary, a default, an
initialiser — it is openly readable by anyone.

This is not a leak in NoxStream (our revocation is a public event anyway, and we say
so in the README's privacy table), but it is a sharp edge that will bite someone
whose default value *is* sensitive. Suggestion: rename to something like
`toPublicEuint256`, or at minimum put a bold note in the API reference next to every
`toEuintN` / `toEintN` / `toEbool`.

### 3.3 The ERC-7984 total-supply ACL trap belongs in the docs, not in a comment `[10]`

Every ERC-7984 wrapper must override `_update` to re-grant
`Nox.allowThis(confidentialTotalSupply())`, or the **second** mint reverts
`NotAllowed`. The first succeeds, so it looks like a gateway or nonce problem rather
than an ACL one, and the failure is far from its cause.

Right now this knowledge exists only as a comment inside the starter's
`ConfidentialToken`. Anyone who writes a wrapper from the API reference rather than
by copying the starter will hit it. It is a two-line note in the ERC-7984 page.

---

## 4. JavaScript SDK (`@iexec-nox/handle`) and browser DX

### 4.1 `createViemHandleClient` cannot be given a `storageService` `[17]`

`HandleClient`'s constructor accepts one and defaults to `InMemoryStorageService`,
but the public factory only forwards `Partial<HandleClientConfig>`. In a browser
that means no localStorage-backed caching, so the hour-long authorisation dies with
the page — every reload costs the user another signature for values they already
authorised. Widening the factory's parameter would fix it.

### 4.2 `isViewer` is the best DX primitive in the SDK and is not exposed `[18]`

`decrypt` uses it internally and its ABI ships in `dist`, but it is not re-exported,
so we hand-wrote the fragment
([`src/contracts/abis.ts`](packages/frontend/src/contracts/abis.ts), used in
[`DecryptionProvider.tsx`](packages/frontend/src/nox/DecryptionProvider.tsx)).

A public `handleClient.isViewer(handle)` would let any UI render an accurate lock
state **without burning a failed signature round-trip**. It is the difference
between a row that says "Not authorised" instantly and one that pops a wallet
prompt and then fails. This is the single highest-leverage export you could add for
frontend developers.

### 4.3 Handle structure is undocumented but very useful `[19]`

`handleToVersion` / `handleToChainId` / `handleToSolidityType` / `handleToAttribute`
exist in `src/utils/types.ts` and are not exported from the package index. We
re-implemented the byte layout
([`src/nox/handle.ts`](packages/frontend/src/nox/handle.ts)) to render
`v1 · chain 11155111 · uint256 · encrypted input` under each handle in the public
view — it is one of the most explanatory things in our UI, because it shows exactly
what *is* public about a ciphertext pointer. Exporting these four helpers saves
every integrator the same reverse-engineering.

### 4.4 `POST /v0/public/handles/status` is undocumented and it should not be `[20]`

It is public, CORS-open (`access-control-allow-origin: *`), signed, and returns
`{payload:{statuses:[{handle,resolved}]},signature}`. It answers `resolved:false`
for unknown handles rather than erroring, which makes it trivially safe to poll.

It is **the single most useful endpoint for browser UX** — it is what lets you wait
for a ciphertext without asking for a signature (see 2.4) — and it appears only
inside the Hardhat plugin's own source (`src/nox.ts`), not in any documentation.
Worth documenting alongside it: a handle whose chain bytes are `0` returns HTTP 400
`unknown_chain`.

---

## 5. Hardhat plugin and testing

### 5.1 The internal handle poller is testnet-hostile `[4]`

`src/nox-config.ts` sets `RESOLVE_MAX_RETRIES = 60` at `RESOLVE_DELAY_MS = 100` — it
gives up after **6 seconds**. That is fine for the local Docker stack and far too
short for the shared testnet gateway, where resolution routinely takes tens of
seconds. `nox.decrypt()` calls this internally, so slow resolution surfaces as an
opaque throw that reads like a permissions failure rather than a timeout. Both our
test helper and our frontend now wait on the status endpoint first, before calling
into the SDK at all. Please make these configurable, or scale the default by network
type.

### 5.2 `nox.connect()` hardcodes a placeholder subgraph `[5]`

`src/nox.ts` passes `subgraphUrl: "https://example.com/subgraphs/id/none"`. Anything
that needs `viewACL` must therefore bypass the plugin's client and construct
`@iexec-nox/handle` directly. Real per-chain subgraph URLs already exist in
`@iexec-nox/handle`'s `src/config/networks.ts` — the plugin could simply forward
them.

### 5.3 The local stack is single-instance, but the test runner is parallel by default `[24]`

The plugin's local stack binds port 8545 and refuses a second instance, while
`hardhat-node-test-runner` hardcodes `concurrency: true`, so `node:test` runs test
*files* in parallel workers. **Exactly one file per project may call `nox.connect()`.**

The failure is:

```
Port 8545 is already in use
```

raised from a file that never mentions ports, in a run where the file that actually
holds the stack may pass. We now carry a warning banner at the top of
[`test/unit/payroll.test.ts`](packages/contracts/test/unit/payroll.test.ts) and
[`test/unit/leak-scanner.test.ts`](packages/contracts/test/unit/leak-scanner.test.ts)
saying which single file is allowed to touch a network. Suggestions: have the plugin
detect an already-running stack and reuse it, or ship a documented
`concurrency: false` recipe, or at minimum make the error message name Nox.

### 5.4 `hardhat test <dir>` is not supported in Hardhat 3 `[25]`

A directory resolves to `<dir>/index.ts`, and a quoted glob is passed through
literally. Scripts need a shell-expanded glob or an explicit file list — ours is
`hardhat test test/unit/*.test.ts`. Not a Nox bug, but the Nox starter's scripts
should reflect it.

### 5.5 The official starter does not compile against the current plugin `[2] [3]`

Two independent breaks, both against `@iexec-nox/nox-hardhat-plugin@0.2.0`:

- `nox-hardhat-starter/test/utils/handle-gateway.ts` and
  `test/integration/stack.test.ts` import `HANDLE_GATEWAY_URL` from the plugin.
  v0.2.0 removed that export — its own CHANGELOG says so. The plugin now exports
  only `nox` and the default plugin.
- The starter calls `nox.connect()` with **no arguments**; v0.2.0 requires a
  `NetworkConnection`.

The starter is the first thing a hackathon participant clones, and it does not
build. A CI job in the starter repo that installs the latest published plugin would
have caught both. This is the highest-impact, lowest-effort fix on the list.

---

## 6. Documentation

### 6.1 Sepolia support is understated, and the warning costs users real time `[1] [21]`

The *Advanced Configuration* page says full Ethereum Sepolia support "ships with an
upcoming release" and that the SDK meanwhile resolves Arbitrum Sepolia. That is false
as of `@iexec-nox/handle@0.1.0-beta.13`: `src/config/networks.ts` contains a complete
`11155111` entry, and we confirmed empirically that
`createViemHandleClient(walletClient)` auto-resolves chain 11155111 in the browser
with no override at all. We wrote a manual override we did not need, then removed it.

A stale "not supported yet" warning is worse than no warning — it makes people build
workarounds for a problem that no longer exists.

### 6.2 The Networks page renders client-side, so it has no addresses in it `[6]`

The docs site renders network data client-side, so the Networks page contains no
addresses in its HTML **or** in its `.md` source. Since the `.md` suffix and
`/llms.txt` are otherwise excellent (see §1), the one table you most need is
precisely the one that is missing. We ended up taking NoxCompute's address from
`Nox.sol::noxComputeContract()` in the contracts package and verifying it with
`eth_getCode`, which is a fine provenance chain — but it should not be necessary.

Suggestion: emit the network table into the markdown at build time.

---

## 7. Suggestions, ranked by developer-hours saved

| # | Change | Where | Impact |
|---|---|---|---|
| 1 | Document that the ACL is checked against the **calling contract**; put `(handle, caller)` in `NotAllowed` | docs + `Nox.sol` | Unblocks every multi-contract confidential system |
| 2 | Prefer `walletClient.account.address` over `getAddresses()[0]` | `@iexec-nox/handle` `WalletClientAdapter` | Removes an entire class of false "missing ACL grant" bugs |
| 3 | Fix the starter's `HANDLE_GATEWAY_URL` import and `nox.connect()` signature; add CI against the published plugin | `nox-hardhat-starter` | The first thing every participant clones currently does not build |
| 4 | Check handle status before signing; cache the authorisation on failure | `@iexec-nox/handle` `decrypt()` | Stops the repeated-wallet-prompt failure mode on testnet |
| 5 | Document proof expiry vs. `evm_increaseTime`; make `InvalidProof` decodable | docs + ABI export | The hardest bug we hit; unavoidable for time-based contracts |
| 6 | Export `isViewer` | `@iexec-nox/handle` | Accurate lock state in any UI with zero wasted signatures |
| 7 | Document `POST /v0/public/handles/status` | docs | The key to good browser UX; currently discoverable only by reading plugin source |
| 8 | Make `RESOLVE_MAX_RETRIES` / `RESOLVE_DELAY_MS` configurable | `nox-hardhat-plugin` | 6s is unusable against the shared gateway |
| 9 | Correct the Sepolia support warning; emit the Networks table into markdown | docs | Prevents unnecessary workarounds |
| 10 | Export `handleToVersion`/`ChainId`/`SolidityType`/`Attribute` | `@iexec-nox/handle` | Every integrator currently re-implements the byte layout |
| 11 | Grant `msg.sender` on `confidentialTransfer`'s return, or document that it is unusable | `nox-confidential-contracts` | Silent correctness trap in accounting contracts |
| 12 | Rename `toEuintN` or flag that it mints a *public* handle | `Nox.sol` + docs | Prevents a real confidentiality bug in someone's code |
| 13 | Detect and reuse a running local stack, or document `concurrency: false` | `nox-hardhat-plugin` | "Port 8545 is already in use" from a file that never mentions ports |
| 14 | Forward real subgraph URLs instead of `example.com/subgraphs/id/none` | `nox-hardhat-plugin` | `viewACL` currently requires bypassing the plugin |
| 15 | Document the ERC-7984 total-supply `_update` re-grant | docs | Second mint reverts; failure is far from its cause |

---

## 8. Not yours — ecosystem friction, listed for completeness

These cost us real time but are **Sablier / toolchain issues, not iExec's**. They are
here only so the writeup is complete, and separated so they are not mistaken for
Nox findings.

- **`@sablier/evm-utils`' postinstall breaks a clean `npm install` `[11]`.** It runs
  `cd node_modules/forge-std && ln -sf src/* .`, which fails and aborts the entire
  install, making `@sablier/lockup` uninstallable. Worked around with a root
  [`.npmrc`](.npmrc) setting `ignore-scripts=true`.
- **`@sablier/lockup` pins `@openzeppelin/contracts` to exact `5.3.0` `[12]`**, so npm
  nests a second OZ copy and solc fails with `Invalid implicit conversion from
  contract IERC20 to contract IERC20` — the same type from two trees. Fixed with
  scoped npm `overrides` in both the root and the contracts `package.json`.
- **Sablier has three live Lockup releases on Sepolia with mutually incompatible
  ABIs and no in-band version discriminator `[13]`.** Version has to be probed
  behaviourally: `comptroller()` succeeds on v3/v4 and reverts on v2;
  `MAX_BROKER_FEE()` does the opposite. Evidence in
  [`docs/STREAM_PROTOCOL.md`](docs/STREAM_PROTOCOL.md).
- **solc 0.8.35 raises `DocstringParsingError` `[14]`** when an `@`-prefixed npm
  package name appears mid-line inside a NatSpec comment — it is parsed as an unknown
  doc tag.
- **publicnode's Sepolia RPC returns 403 to Hardhat's EDR forking client `[15]`.**
  Plain JSON-RPC works, forking does not. `https://sepolia.drpc.org` works for both;
  this is recorded in [`.env.example`](packages/contracts/.env.example) so nobody
  else loses an hour to it.

---

## Closing

The thing worth saying plainly: **Nox let us build something we could not have built
any other way, and the parts that were hard were mostly documentation gaps rather
than capability gaps.** The execution model — no mixed plaintext/ciphertext
arithmetic, no branching on encrypted data, fresh ACL grants on every new handle —
is coherent and, once internalised, pushes you toward designs that are actually
private rather than nominally private. Almost every hour we lost went to learning a
rule that already exists in your source and simply is not written down anywhere a
developer will look.

Fix items 1–4 in the table above and the next team building a multi-contract
confidential system will be a day ahead of where we were.
