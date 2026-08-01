# NoxStream — 4-minute demo script

Target runtime **4:00**. Every click path below was read off the shipped components,
not imagined. Component references are linked so you can check any beat against the
code before you record.

The whole demo is built around one shot: **the Public / Private switch in the
masthead re-rendering the same on-chain state two ways** — opaque 32-byte handles for
the world, real numbers for exactly one account — and one row that cannot be
decrypted at all, no matter who is watching.

---

## Before you record

**Blocking prerequisite: the contracts are not yet deployed to Sepolia.** Run
`npm run deploy` first (see [README](../README.md#deploy)). Until
`packages/shared/src/deployments/sepolia.json` exists, the app renders the
[`NotDeployed`](../packages/frontend/src/components/NotDeployed.tsx) panel and every
write button is disabled — honest, but not a demo.

Checklist:

1. `npm run deploy`, then confirm the app no longer shows "No deployment record found".
2. **Two wallets in the browser**, both funded with Sepolia ETH:
   - **A — employer**: the deploying account (it is `registry.employer()`).
   - **B — employee**: any second account; it will be on the roster.
   Have a third address to hand (any address you do **not** control) for the third
   roster row — that is the one that stays locked in the money shot.
3. Mint test tokens: Employer tab → **Aggregate stream** → **Mint 100,000 test mUSDC**.
4. **Do a full warm-up pass off camera.** Handle resolution on the shared Nox gateway
   routinely takes tens of seconds. [`DecryptionProvider`](../packages/frontend/src/nox/DecryptionProvider.tsx)
   caches every decrypted value **per connected account** for the session, so once a
   value has been decrypted the Public↔Private toggle is instant. Flipping to Public
   genuinely re-hides it — the cache is never rendered in the public view — so the
   warm-up costs you nothing in honesty and saves you 40 seconds of dead air.
   Switching accounts clears the cache, so warm up **as account B**, which is the
   account the money shot uses.
5. Check the **Adapter fee tank** tile is not showing the `empty` badge. Sablier v3+
   charges ~0.000483 ETH per withdrawal and a dry tank makes `harvest()` revert —
   the single most likely thing to ruin a live demo. If it is empty, the callout has
   a **Top up** button; anyone may use it.
6. Browser at ~110% zoom so the handle chips and raw logs are legible on video.
   One tab, no devtools until 3:30.

---

## 0:00 – 0:18 · The problem

**On screen:** the hero. Eyebrow *"Nox confidential compute · Ethereum Sepolia"*,
headline **"Payroll that streams in public and pays in private."**, and the three
badges: `aggregate total: public` · `roster membership: public` · `every salary: ciphertext`.

**Say:**
> Token streaming is close to perfect payroll infrastructure. Money unlocks by the
> second, it is non-custodial, and it composes with everything. It has exactly one
> problem, and it is fatal: every salary is public. Anyone can read what each
> employee earns and reconstruct your whole comp band from one stream list.
> NoxStream fixes that without forking the streaming protocol.

---

## 0:18 – 0:45 · The public view: this is what the world sees

**Click path**
1. Masthead switch is on **Public view** (default). Point at it.
2. **Employer** tab → scroll to the **Roster on-chain** card.
3. Click any handle chip in the *"Salary — as stored on-chain"* column
   ([`HandleChip`](../packages/frontend/src/components/HandleChip.tsx)) to expand it.

**On screen:** three roster rows. Addresses in plain text; where the salary should
be, a lock chip. Expanding it shows all 32 bytes plus the decoded line
`v1 · chain 11155111 · uint256 · encrypted input`.

**Say:**
> This is a live read from Sepolia, not a mock. The addresses are public — we do not
> pretend otherwise. But the salary column is a 32-byte handle: a pointer to
> ciphertext that only Nox's TEE can open. Its *structure* is public — you can see
> it is a uint256 on chain 11155111 — and its *value* is not. There is no hidden
> amount field an indexer picks up later. There is no amount on-chain at all.

---

## 0:45 – 1:25 · Plaintext in, ciphertext out

**Click path** (as employer, account A)
1. Scroll up to **Encrypt and submit allocations**
   ([`AllocationComposer`](../packages/frontend/src/components/employer/AllocationComposer.tsx)).
2. In the **Rows** tab, type employee B's address and `5000` under *Monthly mUSDC*.
   Add a second row for the third address, `9000`.
3. Point at the **Monthly total** tile — that number is public and stays public.
4. Click **Encrypt 2 allocations**.
5. Let the *"Plaintext in, ciphertext out"* table render.
6. Click **Submit 2 allocations in one transaction**, confirm in the wallet.

**On screen:** the three-step progress strip; then a table with columns
*Employee* / *What you typed* / *What the chain will store* — the amber `5,000 mUSDC`
on the left, a handle chip and `minted in NNNms` on the right. Underneath:
**Total plaintext bytes sent on-chain — 0, only handles and their proofs.** Then the
green callout *"Every salary is now a handle"* and a confirmed transaction link.

**Say:**
> Here is the only moment in the product where a real salary and its ciphertext are
> on screen together. The encryption happens in this browser. What goes on the wire
> is a handle and a proof — and each handle is bound to the registry's address, so
> it cannot be replayed against any other contract. Two salaries, one transaction,
> zero amounts.

---

## 1:25 – 1:55 · The public half, presented as public

**Click path**
1. Scroll to the **Aggregate stream** card
   ([`StreamPanel`](../packages/frontend/src/components/employer/StreamPanel.tsx)).
   The badge reads `sablier-lockup-linear-v4.0`.
2. Click the **Sablier stream #N** tile link — it opens Sablier Lockup on Etherscan
   in a new tab. Show it for two seconds, close it.
3. Back on the panel, click **Harvest into the vault**.

**On screen:** tiles for *Held by the stream*, *Unlocked, unharvested*, *In the
confidential vault*; the stream id linking to the real Lockup contract; the fee tank.
After harvest, value moves from the middle tile to the right one.

**Say:**
> The employer funds one ordinary Sablier stream. Not a fork, not a patch — the real
> Lockup v4.0 contract, verifiable on Etherscan, appearing in Sablier's own UI and
> subgraph like any other stream. That aggregate is public on purpose: it is what
> keeps payroll auditable. Harvest pulls the unlocked funds into the confidential
> vault and wraps them as an ERC-7984 token — and it is permissionless, so employees
> never wait on their employer to get paid.

---

## 1:55 – 2:30 · Private view: the same state, decrypted

**Click path**
1. Switch the wallet to **account B (employee)**.
2. Click the **Employee** tab.
3. Flip the masthead switch to **Private view**.
4. The *Accrued*, *Claimed to date* and *Your salary rate* tiles decrypt
   automatically ([`ConfidentialValue`](../packages/frontend/src/components/ConfidentialValue.tsx)
   with `auto`). Let the stage labels run — *Checking on-chain access list… → Nox is
   computing this value… → Waiting for your signature… → Decrypting locally…*.
   Sign once when the wallet prompts.
5. Click **decrypted from handle** under the salary rate to expand the provenance line.
6. Click **Claim privately**, confirm.

**On screen:** real numbers where the handles were. The rate reads
`4,999.96 mUSDC / month` — a monthly figure reconstructed from the per-second rate,
which rounds down; the composer flags that shortfall when you type it — with
`1929 base units/second × 2592000 s/month` underneath. *Claimable now* is labelled
*"Computed in your browser from two decrypted values"*.

**Say:**
> Same contract, same storage slots, different reader. Those stages are real work,
> not a progress animation: first an on-chain `isViewer` check, then a wait for Nox
> to finish computing the ciphertext, then exactly one EIP-712 signature — gasless.
> Claiming moves an encrypted amount. Notice the app never asks me to sign for a
> value I am not allowed to see.

---

## 2:30 – 2:55 · The claim, as the chain recorded it

**Click path**
1. Stay on the Employee tab. The **"The claim, as the chain recorded it"** card
   appears once the receipt lands.
2. Point at the **Raw log** block.

**On screen:**

```
topics[0]  0x…                     (event signature)
topics[1]  0x…B                    (employee)
topics[2]  0x…                     (euint256 handle)
data       0x…                     (epoch only)
```

plus `ConfidentialClaim.amount` rendered as a handle chip and `Settlement epoch #N`.

**Say:**
> This is the receipt, unedited. The employee address is there, the epoch is there,
> and where the amount would be there is a handle. An observer learns that this
> address claimed, and when. Not how much, not what they earn, not how they compare
> to anyone else. And in the contract, an over-claim never reverts — it clamps —
> because a revert would let you binary-search a salary by watching which claims
> succeed.

---

## 2:55 – 3:30 · The money shot

**Click path**
1. Still connected as **account B**, click the **Employer** tab and scroll to the
   **Roster on-chain** card ([`RosterTable`](../packages/frontend/src/components/RosterTable.tsx)).
2. Masthead switch on **Public view**: three rows, three handles, identical.
3. Flip to **Private view**. B's own row decrypts on its own (`auto={isYou}`).
4. Click **Decrypt everything I am allowed to see**.
5. The other rows land on **Not authorised**. Click that badge to expand the
   explanation.
6. Flip back to **Public view**, then to **Private view** once more, slowly.

**On screen:** the same table, same rows, same order. In public, three lock chips. In
private, **one** row is `4,999.96 mUSDC / month` and the others are dimmed handles
with a *Not authorised* chip reading *"NoxCompute's access list does not include this
account for this handle, so no decryption was attempted and no signature was
requested."*

**Say:**
> This is the whole product in one control. Nothing on the chain changed between
> these two renderings — the switch does not hide a number the browser already has,
> because in public view there is no number to hide. And when I ask to decrypt
> everything I am allowed to see, exactly one row opens. The others are refused by
> Nox's access list, not by our UI. No signature was even requested for them. That
> is the difference between a privacy feature and a privacy claim.

---

## 3:30 – 3:55 · The proof, in a terminal

**Click path**
1. Cut to a terminal.
2. Run — or show pre-recorded output of — `npm test`.

**Say:**
> A demo that only shows money arriving proves nothing about confidentiality, so the
> test suite tries to falsify the claim and fails if it can. It searches every log
> topic, every calldata blob and the raw storage slots of all three contracts for the
> salary — word-aligned, big-endian, little-endian, and as a decimal string — and the
> scanner self-tests first, because a broken detector reporting "clean" is worse than
> no test at all. A freshly generated third-party key must fail to decrypt, and the
> employee must succeed with the exact right number. Against real Sablier on a
> Sepolia fork, a complete stranger harvested funds into the vault and was blocked
> from redirecting a cent of it to themselves.

*(Optional, if the deploy and live run have happened by recording time: run
`npm run test:e2e` instead — the same assertions against live Sepolia and the live
Nox gateway. If it has not been run, do not imply it has; the fork and unit tiers are
plenty.)*

---

## 3:55 – 4:00 · Close

**On screen:** back to the hero, Public view.

**Say:**
> One public stream in. N encrypted salaries out. Nox gives confidentiality, not
> anonymity — the roster and the aggregate stay public on purpose, and we say so on
> the front page rather than hoping nobody checks.

---

## If something goes wrong on camera

| Symptom | What it is | Recovery |
|---|---|---|
| A tile sits on *"Nox is computing this value…"* | Shared-gateway resolution latency; the elapsed counter next to it is real | Keep talking — the counter makes the wait legible. Do not reload; the poll is cancellable and resumes cleanly. |
| **Harvest into the vault** is disabled with an `empty` badge on the fee tank | Sablier's per-withdrawal native-token fee; the adapter's tank is dry | Use the **Top up** button in the callout. It is a plain ETH transfer to the adapter's open `receive()` — anyone can do it, which is itself worth a sentence. |
| **Claim privately** fails with *"Nothing has been harvested into the vault yet"* | `VaultUnfunded` — funds unlocked but not moved | The callout embeds harvest controls; harvest from the employee account and say so, it demonstrates permissionlessness. |
| A row shows *"Not authorised"* that you expected to decrypt | You are on the wrong account — grants are per-address | Switch wallets. Note the decryption cache clears on account change, so expect the wait again. |
| The app shows *"No deployment record found"* | `sepolia.json` is missing | Stop. Run `npm run deploy`. Do not demo the empty state as if it were the product. |
