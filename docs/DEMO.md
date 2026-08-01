# NoxStream — 4-minute demo script

Target runtime **4:00**, hard cap. Every click path below was read off the shipped
components, and every on-chain fact was re-read from live Sepolia before it was
written down. Component references are linked so you can check any beat against the
code before you record.

**The proof lives inside the rows.** There is no view mode and nothing to switch:
every confidential value renders both of its faces at the same time — the 32-byte
handle the chain actually stores, then whatever a real `decrypt()` returns for the
connected account
([`ConfidentialValue`](../packages/frontend/src/components/ConfidentialValue.tsx)).

```
[ 0x0000aa…1c9f ]  ->  4,999.96 mUSDC / month     this account holds an ACL grant
[ 0x0000aa…8cf4 ]  ->  Not authorised             NoxCompute's ACL excludes it
[ 0x0000aa…fee9 ]  ->  [ Decrypt ]                nothing has been attempted yet
```

The handle is always on the left, at full strength, never dimmed away. The whole
demo is built around one shot: **those states side by side, in one table, on one
screen, simultaneously.** A row that visibly refuses is stronger evidence than a
number that is merely absent — the refusal comes from an on-chain `isViewer` check
against NoxCompute, not from anything in the frontend, and the viewer never has to
hold a previous frame in memory to see it.

The app is a **light** theme — grey page, white cards, violet for ciphertext and
green for plaintext. If your notes or an older cut describe a dark UI, they are
describing something that no longer exists.

---

## The one thing that will ruin the take

The employer holds an **audit grant on every rate handle** —
[`NoxPayrollRegistry._grantRateAccess`](../packages/contracts/contracts/NoxPayrollRegistry.sol)
calls `Nox.allow(rate, _employer)` on every allocation, deliberately, because an
employer who cannot read back what it just wrote cannot audit its own payroll.

**So connected as the employer, all three rows decrypt.** That is correct behaviour
and it is a terrible shot.

> **Film the money shot connected as account B, the employee.** Then exactly one row
> opens and two refuse. If you find yourself looking at three green numbers, you are
> on account A — switch, and expect the decryption cache to clear with the account.

---

## Before you record

**Already done: the contracts are live on Sepolia** (deployed 2026-08-01, addresses
in the [README](../README.md#live-addresses)) and the record is committed, so both
the hosted app and a local `npm run dev` pick them up automatically. **The roster is
already seeded with three employees** — you do not need to invent one.

Record against whichever you prefer:
- **Hosted** — <https://pranay123-stack.github.io/noxstream/> (nothing to install)
- **Local** — `npm run dev`

Checklist:

1. **Two accounts in MetaMask, on Sepolia.** The demo will not work with arbitrary
   accounts: the employee's ability to decrypt comes from an **on-chain ACL grant**
   held by one specific address. Import both burner keys from
   `packages/contracts/.env` (MetaMask → Account menu → *Import account* → paste the
   private key). They are already funded and already wired:

   | Role | Address | Balance | State |
   |---|---|---|---|
   | **A — employer** | `0x3FfbfB0F37c2A1B68eA5c1cCC9d8929BF08d89f0` | ~0.029 ETH | is `registry.employer()`; holds an audit grant on **every** rate |
   | **B — employee** | `0x706480A5937BC0016397DcC92588c22D3cf69Fe5` | ~0.007 ETH | roster row 1, holds a live rate handle |

   These keys are testnet burners and hold nothing else — but they are still private
   keys. Read them from your local `.env`; never paste them into a browser, a chat, or
   anything on screen while recording.

2. **Know what the other two roster rows are, and why they can never open.** They were
   written by [`scripts/seed-roster.ts`](../packages/contracts/scripts/seed-roster.ts),
   which generated each key with `generatePrivateKey()` and **discarded it in the same
   breath**. Nobody holds them — not you, not a judge, not the person who wrote the
   script. Say this on camera: it is the difference between a locked row and a staged
   one.

   | # | Address | Rate on it | Who can decrypt it |
   |---|---|---|---|
   | 1 | `0x706480A5937BC0016397DcC92588c22D3cf69Fe5` | whatever the live e2e run left; **you overwrite it with 5,000/month on camera at 0:45** | account B, and the employer |
   | 2 | `0xd5DdD68AFdF11cEb3bE5B88a784314CEb2923Bd5` (colleague A) | seeded at 8,200.00 / month | **only the employer** — the key is gone |
   | 3 | `0x6b7868A29f6A2c627cA63aC02D004cB4AA28D426` (colleague B) | seeded at 3,450.00 / month | **only the employer** — the key is gone |

   Roster order is insertion order, so B is row 1 and carries the `you` badge when B
   is connected ([`RosterTable`](../packages/frontend/src/components/RosterTable.tsx)).

3. Mint test tokens if the vault needs topping up: Employer tab → **Aggregate stream**
   → **Mint 100,000 test mUSDC**.

4. **Do a full warm-up pass off camera, as account B.**
   [`DecryptionProvider`](../packages/frontend/src/nox/DecryptionProvider.tsx) caches
   every decrypted value **per connected account** for the session, and clears the whole
   cache the moment the account changes — so warming up as A buys you nothing for the
   money shot. Two honest caveats:
   - the 0:45 beat writes a **new** rate handle for B, and settling B mints new accrued
     and claimed handles, so those three are cold again when you reach 1:55. That is
     where the time budget already assumes the wait;
   - a **freshly encrypted input** (a rate straight out of the composer) resolves fast,
     because the browser minted the ciphertext. A **TEE-computed** handle (accrued,
     claimed, a claim amount) is the one that can sit on *"Nox is computing this
     value…"*. The handle chip tells you which kind you are looking at — expand it and
     read the last field.

5. **The 1-hour input-proof expiry.** `NoxCompute` sets
   `proofExpirationDuration = 1 hours` and stamps `createdAt` from the gateway's
   wall clock ([`NOX_NOTES` #22](NOX_NOTES.md)). Handles you encrypt in the composer
   are only submittable for an hour. If you rehearse the encrypt step and then break
   for lunch, **click Re-encrypt before you submit** — otherwise `setAllocations`
   reverts `InvalidProof(..., "Proof expired")`, which viem cannot decode and which
   surfaces as an unrecognised custom error at the worst possible moment.

6. Check the **Adapter fee tank** tile is not showing the `empty` badge. Sablier v3+
   charges ~0.000483 ETH per withdrawal and a dry tank makes `harvest()` revert —
   the single most likely thing to ruin a live demo. At last check the tank held
   ~0.0045 ETH, about nine harvests. If it is empty, the callout has a **Top up**
   button; anyone may use it.

7. **Record wide.** The live-deployment chip in the masthead
   ([`Masthead`](../packages/frontend/src/components/Masthead.tsx)) is hidden below
   980px, and it is a beat in the opening shot. Browser at ~110% zoom on a wide
   window so the handle chips and raw logs stay legible on video. One tab, no
   devtools until 3:30.

8. **Connect as account A before you hit record.** The script switches accounts
   exactly once, at 1:55. Every switch costs you the decryption cache.

---

## 0:00 – 0:18 · The problem

**On screen:** the hero, on the light theme — grey page, white cards. Eyebrow
*"Nox confidential compute · Ethereum Sepolia"*, headline **"Payroll that streams in
public and pays in private."**, three badges — `aggregate total: public` ·
`roster membership: public` · `every salary: ciphertext` — and, under them, the
**HeroProof** strip: a real handle read live from `ratePerSecondOf()` next to the
line *"a real number — but only for an account NoxCompute authorised"*.

Top right, the masthead chip: **● Live on Ethereum Sepolia · registry 0x2c9A…d5A7**,
linking to Etherscan.

**Say:**
> Token streaming is close to perfect payroll infrastructure. Money unlocks by the
> second, it is non-custodial, and it composes with everything. It has exactly one
> problem, and it is fatal: every salary is public. Anyone can read what each
> employee earns and reconstruct your whole comp band from one stream list.
> NoxStream fixes that without forking the streaming protocol.

*(The hero handle is not a sample — [`HeroProof`](../packages/frontend/src/App.tsx)
renders nothing at all when the roster is empty, because inventing a handle there
would undercut the only claim this app makes. Worth one clause if you have it.)*

---

## 0:18 – 0:45 · What the chain actually stores

**Click path** (connected as account A)
1. **Employer** tab → scroll to the **Roster on-chain** card.
2. The salary column header reads *"Salary — stored ciphertext → what you can read"*.
   Point at it.
3. Click the handle chip on row 2
   ([`HandleChip`](../packages/frontend/src/components/HandleChip.tsx)) to expand it.

**On screen:** three roster rows. Addresses in plain text, an `accruing` badge each,
and in the salary column a violet lock chip followed by an arrow and a **Decrypt**
button — nothing has been requested yet. Expanding the chip shows all 32 bytes plus
the decoded line `v0 · chain 11155111 · uint256 · encrypted input`, and the note
*"Public structure, private value."*

**Say:**
> This is a live read from Sepolia, not a mock. Three employees. The addresses are
> public — we do not pretend otherwise. But the salary column is a 32-byte handle: a
> pointer to ciphertext that only Nox's TEE can open. Its *structure* is public — you
> can see it is a uint256 on chain 11155111, and all three share the same first bytes
> for exactly that reason — and its *value* is not. There is no hidden amount field an
> indexer picks up later. There is no amount on-chain at all.

---

## 0:45 – 1:25 · Plaintext in, ciphertext out

**Click path** (as employer, account A)
1. Scroll up to **Encrypt and submit allocations**
   ([`AllocationComposer`](../packages/frontend/src/components/employer/AllocationComposer.tsx)).
2. In the **Rows** tab, first row: employee B's address, and `5000` under
   *Monthly mUSDC*. The composer starts with two blank rows; leave the second one
   untouched — `validateRoster` skips a wholly empty row rather than flagging it.
3. Point at the **Monthly total** tile — that number is public and stays public — and
   at **Aggregate rate**, whose note reads *"Rounding down costs 0.032 mUSDC/month
   across the roster"*. The shortfall is shown, not rounded out of sight.
4. Click **Encrypt 1 allocation**.
5. Let the *"Plaintext in, ciphertext out"* table render.
6. Click **Submit 1 allocation in one transaction**, confirm in the wallet.

> **Do not add a colleague's row to make the batch look bigger.** Typing 8,200 into
> this form puts colleague A's salary in the recording permanently, and the money
> shot at 2:55 depends on those two numbers being genuinely unknown to everyone
> watching. `setAllocations` takes arrays and the button pluralises itself; say that
> in a clause and move on.

**On screen:** the three-step progress strip — *Compose the roster → Encrypt each
salary into a handle → Submit one batched transaction*; then a table with columns
*Employee* / *What you typed* / *What the chain will store* — the amber `5,000 mUSDC`
on the left, a handle chip and `minted in NNNms` on the right. Underneath it, the line
worth pausing on: **Total plaintext bytes sent on-chain — 0 — only handles and their
proofs.** Then the green callout *"Every salary is now a handle"*, the note that the
handle is bound to this registry and cannot be replayed against another contract, and
a confirmed transaction link.

**Say:**
> Here is the only moment in the product where a real salary and its ciphertext are
> on screen together. The encryption happens in this browser. What goes on the wire
> is a handle and a proof — and each handle is bound to the registry's address, so
> it cannot be replayed against any other contract. The registry takes arrays, so a
> hundred salaries would be one transaction too. Zero amounts either way.

---

## 1:25 – 1:55 · The public half, presented as public

**Click path**
1. Scroll to the **Aggregate stream** card
   ([`StreamPanel`](../packages/frontend/src/components/employer/StreamPanel.tsx)).
   The badge reads `sablier-lockup-linear-v4.0`.
2. Click the **Sablier stream** tile link — stream **167** on the real Lockup contract,
   opening on Etherscan in a new tab. Show it for two seconds, close it.
3. Back on the panel, click **Harvest into the vault**.

**On screen:** tiles for *Held by the stream*, *Unlocked, unharvested*, *In the
confidential vault*, *Payroll clock* and *Adapter fee tank*; the stream id linking to
the live Lockup contract. After harvest, value moves from the middle tile to the
right one.

**Say:**
> The employer funds one ordinary Sablier stream. Not a fork, not a patch — the real
> Lockup v4.0 contract, verifiable on Etherscan, appearing in Sablier's own UI and
> subgraph like any other stream. That aggregate is public on purpose: it is what
> keeps payroll auditable. Harvest pulls the unlocked funds into the confidential
> vault and wraps them as an ERC-7984 token — and it is permissionless, so employees
> never wait on their employer to get paid.

---

## 1:55 – 2:30 · The same state, read by the account that owns it

**Click path**
1. Switch the wallet to **account B (employee)**. The cache clears; that is by design.
2. Click the **Employee** tab.
3. The *Accrued*, *Claimed to date* and *Your salary rate* tiles each render their
   handle immediately and then decrypt on their own
   ([`ConfidentialValue`](../packages/frontend/src/components/ConfidentialValue.tsx)
   with `auto`). Let the stage labels run — *Checking on-chain access list… → Nox is
   computing this value… → Waiting for your signature… → Decrypting locally…*. Sign
   once when the wallet prompts.
4. The *Wallet balance* tile does **not** auto-decrypt — it has no `auto` prop, so it
   sits at handle → **Decrypt** until you click it. Click it, and say why: even your
   own ERC-7984 wallet total is ciphertext until you ask for it.
5. Click **decrypted from handle** under the salary rate to expand the provenance
   line.
6. Click **Claim privately**, confirm.

**On screen:** the handle stays put on the left of every tile; a real number appears
to the right of it. The rate reads `4,999.96 mUSDC / month` — a monthly figure
reconstructed from the per-second rate, which rounds down; the composer flagged that
shortfall when you typed it — with `1929 base units/second × 2592000 s/month`
underneath. *Claimable now* is labelled *"computed in your browser from two decrypted
handles"*. Below, the card **"What this account looks like to everyone else"** shows
the same four values as bare handles.

**Say:**
> Same contract, same storage slots, different reader — and notice the ciphertext
> never left the screen. Those stages are real work, not a progress animation: first
> an on-chain `isViewer` check, then a wait for Nox to finish computing the
> ciphertext, then exactly one EIP-712 signature — gasless. Claiming moves an
> encrypted amount. The app never asks me to sign for a value I am not allowed to see.

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

**Still connected as account B.** This is the beat the account choice exists for.

**Click path**
1. Click the **Employer** tab and scroll to the **Roster on-chain** card
   ([`RosterTable`](../packages/frontend/src/components/RosterTable.tsx)).
2. Row 1 carries the `you` badge and is **already decrypted** — `auto={isYou}` fired,
   and the value is warm from the Employee tab a minute ago. Rows 2 and 3 sit at
   handle → **Decrypt**.
3. Above the table: *"2 rows not yet attempted. Nothing is decrypted until you ask
   for it."* Read it out, then click **Decrypt everything I am allowed to see**.
4. Both rows land on **Not authorised** in a second or two — an `isViewer` call is a
   plain `eth_call`, so the refusal is fast and no wallet prompt appears.
5. Click one of the **Not authorised** chips to expand the explanation.
6. Hold the wide shot for three seconds. Do not scroll. This frame is the thumbnail.

**On screen:** one table, three rows, three violet handle chips at full strength on
the left. Row 1 continues into a green `4,999.96 mUSDC / month`. Rows 2 and 3 continue
into a lock chip reading *"NoxCompute's access list does not include this account for
this handle, so no decryption was attempted and no signature was requested. That is
the system working: the handle is public, the number is not."* Under the table:
*"The left-hand bytes are the whole of it."*

**Say:**
> This is the whole product in one frame. Nothing is hidden and nothing is being
> re-rendered: the ciphertext and the plaintext are on screen at the same time. One
> table, three rows, three handles, all still there. One of them turns into a number,
> because NoxCompute lists this account as a viewer of that handle. The other two do
> not, and I want to be
> precise about why: those two colleagues' private keys were generated during seeding
> and thrown away in the same script. Nobody has them. Those rows are exactly as
> opaque to me as they are to you. And when I asked to decrypt everything I am
> allowed to see, the wallet never even prompted for them — Nox refused before a
> signature was worth asking for. That is the difference between a privacy feature
> and a privacy claim.

*(If you want one extra second: expand row 2's handle chip while it is refused. Full
32 bytes, public structure, and still no number. That is the entire thesis in one
row.)*

---

## 3:30 – 3:55 · The proof, in a terminal

**Click path**
1. Cut to a terminal.
2. Run — or show pre-recorded output of — `npm test` (29 unit + 5 Sablier fork), and
   `npm run test:e2e` (8 tests against the live deployment) if you have the four
   minutes to spare.

**Say:**
> A demo that only shows money arriving proves nothing about confidentiality, so the
> test suite tries to falsify the claim and fails if it can. It searches every log
> topic, every calldata blob and the raw storage slots of all three contracts for the
> salary — word-aligned, big-endian, little-endian, and as a decimal string — and the
> scanner self-tests first, because a broken detector reporting "clean" is worse than
> no test at all. A freshly generated third-party key must fail to decrypt, and the
> employee must succeed with the exact right number. Against real Sablier on a
> Sepolia fork, a complete stranger harvested funds into the vault and was blocked
> from redirecting a cent of it to themselves. And all of it has been run against the
> live deployment: 264 hex fields across five transactions, 144 storage words across
> three contracts — clean.

---

## 3:55 – 4:00 · Close

**On screen:** back to the top of the page — hero, HeroProof strip, live chip.

**Say:**
> One public stream in. N encrypted salaries out. Nox gives confidentiality, not
> anonymity — the roster and the aggregate stay public on purpose, and we say so on
> the front page rather than hoping nobody checks.

---

## If something goes wrong on camera

| Symptom | What it is | Recovery |
|---|---|---|
| **All three roster rows decrypt** | You are connected as the **employer**, which holds an audit grant on every rate by design | Switch to account B and re-shoot the beat. Expect the cache to clear and the first decrypt to prompt for a signature again. |
| A tile sits on *"Nox is computing this value…"* | Shared-gateway resolution latency on a TEE-computed handle; the elapsed counter next to it is real | Keep talking — the counter makes the wait legible. Do not reload; the poll is cancellable and resumes cleanly. |
| A row you expected to open says *"Not authorised"* | Grants are per-address, and the cache is per-account | Check the wallet. Row 1 is B's; rows 2 and 3 open for nobody but the employer. |
| **Submit** reverts with an unrecognised custom error `0xae385f38` | `InvalidProof(..., "Proof expired")` — the handles were encrypted more than an hour ago | Click **Re-encrypt**, then submit again. See checklist item 5. |
| **Harvest into the vault** is disabled with an `empty` badge on the fee tank | Sablier's per-withdrawal native-token fee; the adapter's tank is dry | Use the **Top up** button in the callout. It is a plain ETH transfer to the adapter's open `receive()` — anyone can do it, which is itself worth a sentence. |
| **Claim privately** fails with *"Nothing has been harvested into the vault yet"* | `VaultUnfunded` — funds unlocked but not moved | The callout embeds harvest controls; harvest from the employee account and say so, it demonstrates permissionlessness. |
| The masthead live chip is missing | The window is narrower than 980px | Widen the window before recording the opening shot. |
| The app shows *"No deployment record found"* | `sepolia.json` is missing | Stop. Run `npm run deploy`. Do not demo the empty state as if it were the product. |
