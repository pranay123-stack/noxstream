# Nox ground truth (verified 2026-07-31)

Everything here was checked against shipped code or a live endpoint. Where the
published docs disagree, **this file wins** — several doc pages are stale, and
those discrepancies are themselves deliverables for `feedback.md`.

## Live Ethereum Sepolia parameters

| Thing | Value | How it was verified |
|---|---|---|
| Chain | Ethereum Sepolia `11155111` | — |
| NoxCompute | `0x24Ef36Ec5b626D7DCD09a98F3083c2758F0F77bF` | hardcoded in `Nox.sol::noxComputeContract()`; `eth_getCode` returns real ERC-1967 proxy runtime |
| Handle Gateway | `https://gateway-testnets.noxprotocol.dev` | HTTP 200; `POST /v0/public/handles/status` is the status endpoint (GET returns 405) |
| Subgraph | `https://thegraph.ethereum-sepolia-testnet.noxprotocol.io/api/subgraphs/id/9CsccKwvgYFo72zZeU4k4wj2NEBLdWhVE3EUandgmzgo` | answered a `_meta` query, block 11,389,792 |

Arbitrum Sepolia (`421614`) is the other supported chain; NoxCompute there is
`0xd464B198f06756a1d00be223634b85E0a731c229`. We target Ethereum Sepolia.

## Package versions (installed and compiling)

```
@iexec-nox/nox-hardhat-plugin         0.2.0
@iexec-nox/nox-protocol-contracts     0.2.4
@iexec-nox/nox-confidential-contracts 0.2.2
@iexec-nox/handle                     0.1.0-beta.13
hardhat                               3.12.0   (Hardhat 3, ESM, Node 22+)
solc                                  0.8.35   (optimizer + viaIR)
```

Node 22 is mandatory. This machine's default `node` is v20; use
`export PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH"`.

## Doc/code discrepancies found (raw material for feedback.md)

1. **Sepolia support is understated.** `advanced-configuration` says full
   Ethereum Sepolia support "ships with an upcoming release" and that the SDK
   meanwhile resolves Arbitrum Sepolia. False as of `handle@0.1.0-beta.13`:
   `src/config/networks.ts` contains a complete `11155111` entry. The warning
   costs users a needless manual override.
2. **The official starter does not compile against the current plugin.**
   `nox-hardhat-starter/test/utils/handle-gateway.ts` imports
   `HANDLE_GATEWAY_URL` from `@iexec-nox/nox-hardhat-plugin`; plugin v0.2.0
   removed that export (its own CHANGELOG says so). Plugin 0.2.0 exports only
   `nox` and the default plugin.
3. **The starter's `nox.connect()` signature is a version behind.** Starter
   calls it with no arguments; v0.2.0 requires a `NetworkConnection`.
4. **The plugin's internal handle poller is testnet-hostile.** `nox-config.ts`
   sets `RESOLVE_MAX_RETRIES = 60` at `RESOLVE_DELAY_MS = 100` — it gives up
   after **6 seconds**. Fine for the local Docker stack, too short for the
   shared testnet gateway. `nox.decrypt()` calls this internally, so slow
   resolution surfaces as an opaque throw.
5. **`nox.connect()` hardcodes a placeholder subgraph** —
   `https://example.com/subgraphs/id/none`. Anything needing `viewACL` must use
   `@iexec-nox/handle` directly rather than the Hardhat plugin's client.
6. **The docs site renders network data client-side**, so the Networks page has
   no addresses in its HTML or its `.md` source. Appending `.md` to any docs URL
   returns clean markdown (`/llms.txt` lists every page) — very useful, but the
   one table you most need is the one that is missing.
7. **ACL is checked against the *calling contract*, and this is not documented.**
   A handle's ACL must grant every contract that will *compute* on it, not just
   the humans who may decrypt it. `NoxStreamPayroll.claim()` evaluates
   `rate * elapsed` on a handle minted by `NoxPayrollRegistry`, so the payroll
   contract itself needs a grant — hence `INoxPayrollRegistry.setPayroll()`.
   Without it `Nox.safeMul` reverts `NotAllowed` inside `claim()`, arbitrarily
   far from the `setAllocation` that actually caused it. This is the single
   costliest thing to learn by trial and error, and it is the main reason
   multi-contract confidential systems are harder than the single-contract
   examples suggest.
8. **`confidentialTransfer` returns a handle the caller cannot use.** Under
   `_updateWithOptimizedPrimitives`, the returned `transferred` handle receives
   **no ACL grants at all**, whereas `_updateWithRawPrimitives` grants
   `from`/`to`/`this`. `confidentialTransferFrom` papers over it with
   `Nox.allowTransient(transferred, msg.sender)`; plain `confidentialTransfer`
   does not. A contract that needs to book what actually moved must track its
   own pre-clamped value. Asymmetric between the two paths and undocumented.
9. **`Nox.toEuint256(x)` mints a *public* handle** (it calls
   `wrapAsPublicHandle`). Neither the name nor the docs suggest this, and it
   means `Nox.allow(...)` on the result is silently a no-op. Anywhere a
   plaintext constant is stored as a "confidential" value — a zeroed-out salary,
   say — it is openly readable. Not a leak in NoxStream (revocation is public
   anyway), but a sharp edge that will bite someone.
10. **The ERC-7984 total-supply ACL trap deserves to be in the docs.** Every
   wrapper must override `_update` to re-grant
   `Nox.allowThis(confidentialTotalSupply())`, or the *second* mint reverts
   `NotAllowed`. Currently this knowledge exists only as a comment in the
   starter's `ConfidentialToken`.

## JS SDK / browser DX findings (from building the frontend)

16. **`decrypt()` asks for a signature before it checks whether the handle is
    even computable.** It generates the EIP-712 authorisation first, then
    retries the gateway for ~7s (1s/2s/4s), and on failure does not cache the
    material it just signed for. On a testnet where resolution takes tens of
    seconds, every retry pops a *fresh wallet prompt* — the worst possible UX.
    Worked around by polling the unsigned public status endpoint ourselves and
    signing exactly once. Upstream fix: check handle status before requesting
    the signature, and cache the authorisation regardless of outcome.
17. **`createViemHandleClient` cannot be given a `storageService`.**
    `HandleClient`'s constructor accepts one and defaults to
    `InMemoryStorageService`, but the public factory only forwards
    `Partial<HandleClientConfig>`. In a browser that means no localStorage-backed
    caching, so the hour-long authorisation dies with the page.
18. **`isViewer` is the best DX primitive in the SDK and is not exposed.**
    `decrypt` uses it internally and its ABI ships in `dist`, but it is not
    re-exported, so we hand-wrote the fragment. `handleClient.isViewer(handle)`
    would let any UI render an accurate lock state without burning a failed
    signature round-trip.
19. **Handle structure is undocumented but very useful.**
    `handleToVersion/ChainId/SolidityType/Attribute` exist in `utils/types.ts`
    and are not exported from the package index. We re-implemented the byte
    layout to render "v1 · chain 11155111 · uint256 · encrypted input" in the
    public view. Exporting these saves every integrator the same work.
20. **`POST /v0/public/handles/status` is undocumented, public, CORS-open
    (`access-control-allow-origin: *`) and signed.** It returns
    `{payload:{statuses:[{handle,resolved}]},signature}` and answers
    `resolved:false` for unknown handles rather than erroring. It is the single
    most useful endpoint for browser UX, and it appears only inside the Hardhat
    plugin's source. Also worth documenting: a handle whose chain bytes are `0`
    returns HTTP 400 `unknown_chain`.
21. **Confirmed empirically that finding #1 is a docs bug**, not a packaging one:
    `createViemHandleClient(walletClient)` auto-resolved chain 11155111 in the
    browser with no override at all.

## Testing / Hardhat-plugin findings (from building the test suite)

22. **Input proofs expire after 1 hour of WALL-CLOCK time, which silently breaks
    time travel.** `NoxCompute` sets `proofExpirationDuration = 1 hours` and
    `Compute.sol` enforces `block.timestamp <= createdAt + duration`, where
    `createdAt` is stamped by the *gateway* from real wall-clock time. So
    Hardhat's `evm_increaseTime` permanently consumes that budget for every
    later `encryptInput` in the same process. Advancing 4 days to test salary
    accrual made every subsequent `setAllocation` revert
    `InvalidProof(..., "Proof expired")` — and viem cannot decode it, so it
    surfaces as `unrecognized custom error 0xae385f38`. Nothing in the docs
    connects time travel to encryption; this is the hardest-to-diagnose problem
    we hit, and it will hit anyone testing a time-based confidential contract.
23. **`@iexec-nox/handle` signs as one account and identifies as another.**
    `WalletClientAdapter.signTypedData` uses `walletClient.account`, but
    `getAddress()` uses `getAddresses()[0]` — the node's full `eth_accounts`
    list. With Hardhat/Anvil, a client for account #1 signs as #1 while claiming
    to be #0. The gateway then answers `401 invalid signature`, or "user 0x… is
    not authorized to decrypt it" naming an address you never asked about —
    indistinguishable from a missing ACL grant. Upstream fix: prefer
    `account.address` when present.
24. **The plugin's local stack is single-instance per machine** (binds 8545,
    refuses a second), but `hardhat-node-test-runner` hardcodes
    `concurrency: true`, so `node:test` runs test *files* in parallel workers.
    Exactly one file per project may call `nox.connect()`. The failure is
    "Port 8545 is already in use" raised from a file that never mentions ports.
25. **`hardhat test <dir>` is not supported in Hardhat 3** — a directory
    resolves to `<dir>/index.ts`, and a quoted glob is passed through
    literally. Scripts need a shell-expanded glob or an explicit file list.

## Non-Nox findings (Sablier / toolchain) — also for feedback.md

These are not iExec's fault, but they cost real time and belong in the writeup
as ecosystem friction:

11. **`@sablier/evm-utils` postinstall breaks a clean `npm install`.** It runs
    `cd node_modules/forge-std && ln -sf src/* .`, which fails and aborts the
    whole install, making `@sablier/lockup` uninstallable. Worked around with a
    root `.npmrc` setting `ignore-scripts=true` so a clean clone still works
    with a plain `npm install`.
12. **`@sablier/lockup` pins `@openzeppelin/contracts` to exact `5.3.0`**, so npm
    nests a second OZ copy and solc fails with `Invalid implicit conversion from
    contract IERC20 to contract IERC20` — the same type from two trees. Fixed
    with scoped npm `overrides`. Baffling on first contact.
13. **Sablier has three live Lockup releases on Sepolia with mutually
    incompatible ABIs and no in-band version discriminator.** Version must be
    probed behaviourally: `comptroller()` succeeds on v3/v4 and reverts on v2;
    `MAX_BROKER_FEE()` does the opposite.
14. **solc 0.8.35 raises `DocstringParsingError`** when an `@`-prefixed npm
    package name appears mid-line inside a NatSpec comment — it is parsed as an
    unknown doc tag.
15. **publicnode's Sepolia RPC returns 403 to Hardhat's EDR forking client.**
    Plain RPC works, forking does not. Use `https://sepolia.drpc.org`.

## Nox Solidity API — the whole surface

Import: `import {Nox, ebool, euint16, euint256, eint16, eint256, externalEuint256} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";`

- Lift plaintext: `Nox.toEuint256(uint256)`, `toEuint16`, `toEint256`, `toEint16`, `toEbool`
- Ingest user input: `Nox.fromExternal(externalEuint256, bytes proof) -> euint256`
- Arithmetic: `add`, `sub`, `mul`, `div`
- Checked arithmetic: `safeAdd`, `safeSub`, `safeMul`, `safeDiv` -> `(ebool ok, euint256 v)`
- Comparison: `eq`, `ne`, `gt`, `ge`, `lt`, `le` -> `ebool`
- Branchless choice: `select(ebool, euint256, euint256)` — exists for
  `euint16/euint256/eint16/eint256`
- ACL: `allowThis`, `allow(v, account)`, `allowTransient`, `disallowTransient`,
  `addViewer`, `allowPublicDecryption`
- Introspection: `isAllowed`, `isViewer`, `isInitialized`, `isPubliclyDecryptable`

### Three rules that shape every contract here

1. **No mixed plaintext/ciphertext arithmetic.** There is no
   `mul(euint256, uint256)`. Lift first: `Nox.mul(rate, Nox.toEuint256(elapsed))`.
2. **You cannot branch on encrypted data.** `ebool` is a ciphertext, so
   `require`/`if`/`revert` on it is impossible. Use the clamp pattern:
   ```solidity
   (ebool ok, euint256 updated) = Nox.safeSub(balance, amount);
   balance = Nox.select(ok, updated, balance);   // silently no-ops on failure
   ```
   This is also the privacy-correct behaviour: a revert would be a public side
   channel that leaks the encrypted comparison's result.
3. **Every new handle needs fresh ACL grants.** A handle produced by an
   operation is accessible to nobody by default — not even the contract that
   made it. After each write: `Nox.allowThis(v)` plus `Nox.allow(v, reader)`.
   Forgetting this makes the *next* call revert with `NotAllowed`, far from the
   real cause. (The starter's `ConfidentialToken` overrides `_update` purely to
   re-grant the total-supply handle for this reason.)

## Nox JS SDK

```ts
import { createViemHandleClient } from "@iexec-nox/handle";
const handle = await createViemHandleClient(walletClient); // auto-resolves 11155111
const { handle: h, handleProof } = await handle.encryptInput(1000n, "uint256", contractAddress);
const { value } = await handle.decrypt(h);          // needs an ACL grant, EIP-712 signed, gasless
const { value } = await handle.publicDecrypt(h);    // only if allowPublicDecryption was called
```

`encryptInput` binds the handle to `applicationContract` — a handle minted for
one contract cannot be replayed against another.

## Hardhat plugin

```ts
import { network } from "hardhat";
import { nox } from "@iexec-nox/nox-hardhat-plugin";

const connection = await network.connect({ network: "sepolia" });
const noxClient = await nox.connect(connection);
// -> { noxComputeAddress, handleGatewayUrl, encryptInput, decrypt, publicDecrypt }
```

A network of `type: "http"` **must** carry a `nox: { noxComputeAddress,
handleGatewayUrl }` block or `nox.connect()` throws. `edr-simulated` networks
boot the local Docker stack instead (Docker must be running).

## ERC-7984 confidential token

From `@iexec-nox/nox-confidential-contracts`:

- `ERC7984` — `confidentialBalanceOf(address) -> euint256`,
  `confidentialTotalSupply()`, `confidentialTransfer(...)`,
  `confidentialTransferFrom(...)`, `setOperator(address, uint48 until)`,
  `confidentialTransferAndCall(...)`
- `ERC20ToERC7984Wrapper` — `wrap(address to, uint256 amount) -> euint256`,
  `unwrap(...)`, `finalizeUnwrap(...)`, `underlying()`

Unwrap is **two-phase and asynchronous** (`UnwrapRequested` then
`UnwrapFinalized`) because turning ciphertext back into a public ERC-20 amount
requires an off-chain decryption round-trip. Any UI or test touching unwrap must
handle that as a wait, not a single call.
