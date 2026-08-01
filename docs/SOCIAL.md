# Launch post — DRAFT

> **This is a draft for the repo owner to post. Nothing here has been published
> anywhere.** Fill the placeholder, check the claims against reality at the
> moment of posting, then post it yourself.

**Placeholders to fill before posting**

| Placeholder | What goes there |
|---|---|
| `<VIDEO_URL>` | the demo recording (or attach the video natively — native video outperforms a link) |

The repo URL (https://github.com/pranay123-stack/noxstream) and the live app URL
(https://pranay123-stack.github.io/noxstream/) are real and already in every variant.

**Check before you post — every claim below must still be true**

- [ ] Repo is public and the README renders.
- [ ] `npm test` still passes on a clean clone (29 unit + 5 fork).
- [ ] The demo video shows what the copy says it shows. **In particular: no variant
      below mentions a public/private toggle, because the app no longer has one.** The
      shot is one roster table where an authorised row and two unauthorised rows sit
      side by side, handles visible on all three.
- [ ] The Sepolia deployment is live and the live-e2e tier has been run (8 passing), so
      the variants below may say so. If either stops being true, cut the claim rather
      than softening it.
- [ ] Handle is `@iEx_ec`. Tag Sablier (`@Sablier`) only in the thread, where there
      is room to be specific — a tag with no substance is spam.

---

## Variant A — concise (single post)

> Token streaming is great payroll infrastructure with one fatal flaw: every salary
> is public.
>
> NoxStream fixes that without forking the streaming protocol. One ordinary Sablier
> stream funds the company — auditable, composable, unchanged. Every individual
> salary lives in @iEx_ec Nox as an encrypted handle.
>
> One roster. One screen. Three encrypted handles — and only the row you hold a grant
> on turns into a number.
>
> <VIDEO_URL>
> https://github.com/pranay123-stack/noxstream
> Live: https://pranay123-stack.github.io/noxstream/

*Notes:* leads with the insight, not the tech. The video does the selling. As written
it is ~450 characters — fine for X Premium, LinkedIn or Farcaster. For a plain 280-char
post, cut the middle paragraph and attach the video natively instead of linking it: X
counts every URL as 23 characters, and one link plus the two remaining paragraphs lands
around 268.

---

## Variant B — the money-shot post (single post, video-first)

> Three rows of one payroll table, read by one wallet:
>
> 0x0000aa…1c9f → 4,999.96 mUSDC / month
> 0x0000aa…8cf4 → Not authorised
> 0x0000aa…fee9 → Not authorised
>
> The handle is on screen for all three. Only one becomes a number, and @iEx_ec Nox
> decides which — not our UI. No fork of Sablier required.
>
> <VIDEO_URL>
> https://github.com/pranay123-stack/noxstream
> Live: https://pranay123-stack.github.io/noxstream/

*Notes:* the contrast lives inside a single frame now, so this works with a still as
well as a video — no cut, no before/after, nothing the viewer has to hold in memory.
Two of those locked rows belong to addresses whose private keys were generated during
seeding and discarded, which is worth saying in a reply if anyone asks whether it is
staged. Handles are illustrative of the shape; paste the real ones out of the recording
so they match the frame.

---

## Variant C — thread (5 posts)

**1/**
> Every token-streaming payroll design has the same hole: salaries are public. You
> can read what each person earns and reconstruct a company's whole comp band from
> one stream list.
>
> NoxStream closes it without touching the streaming protocol. In the video: one
> roster table, three encrypted handles, and only the row this wallet holds a grant
> on turns into a number. Here is how. 🧵
>
> <VIDEO_URL>

**2/**
> The split: the treasury funds ONE ordinary @Sablier Lockup stream — public,
> auditable, fully composable. Sablier is unmodified and never learns NoxStream
> exists.
>
> Only the per-employee breakdown moves into @iEx_ec Nox, as euint256 handles.
> Aggregate public, split private.

**3/**
> Accrual and claims run entirely on ciphertext inside the TEE:
>
> owed = rate × elapsed
> entitlement = accrued − claimed
> pay = min(entitlement, vault)
>
> Every clamp is a `select`, never a `revert` — a revert on an encrypted comparison
> would let anyone binary-search a salary by watching which claims succeed.

**4/**
> A demo that only shows money arriving proves nothing about confidentiality, so the
> tests try to falsify the claim:
>
> · every log topic, calldata blob and raw storage slot searched for the salary in 4
>   encodings
> · the leak scanner is itself tested, offline, on every push
> · a third party's decrypt must FAIL; the employee's must succeed with the exact
>   number
>
> 42 tests in three tiers: 19 against a real Nox stack in Docker, 10 testing the
> scanner itself offline, 5 against real unmodified Sablier Lockup v4.0 bytecode on a
> Sepolia fork, and 8 against the live Sepolia deployment — where the scan came back
> clean across 264 hex fields in 5 transactions and 144 storage words in 3 contracts.

**5/**
> Stated plainly, because overclaiming here would be easy: Nox gives
> **confidentiality, not anonymity**. Roster membership, the aggregate stream and
> the fact that an address claimed at time T are all public — on purpose.
>
> MIT, and the feedback we owe @iEx_ec is in the repo.
>
> https://github.com/pranay123-stack/noxstream
> Live: https://pranay123-stack.github.io/noxstream/

*Notes:* post 5 is the one that earns trust with people who actually read code, and
it is also the post most likely to get a reply from the iExec team — engineers
respond to honest limits. Posts 1 and 4 run past 280 characters; either use X Premium
or split post 4 at the blank line, keeping the falsification bullets and the test
counts as separate posts.

---

## Suggested tags and hashtags

`@iEx_ec` in every variant. `@Sablier` only in thread post 2, where the claim about
them is specific and accurate. Two hashtags maximum, appended to the final post only:
`#confidentialcomputing` `#TEE`. Skip `#web3` and `#buildinpublic` — they add reach of
the wrong kind.

## Tone guardrails applied

- No numbers that were not measured. The only figures used are test counts, the leak
  scan's field and slot counts, and the Sablier release version — all verifiable in the
  repo and in the live run log in the README.
- The deployment record `packages/shared/src/deployments/sepolia.json` exists and the
  addresses in it are live, so "live on Sepolia" is now sayable. It was not before, and
  nothing here should outrun the file again.
- No control is described that the app does not have. The public/private toggle was
  removed; the proof is the per-row contrast, and the copy says only that.
- No "revolutionary", no "game-changing", no implied endorsement by iExec or Sablier.
- The limitation (confidentiality ≠ anonymity) is in the thread rather than buried,
  because the audience that matters will check.
