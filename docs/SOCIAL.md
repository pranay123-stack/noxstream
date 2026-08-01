# Launch post — DRAFT

> **This is a draft for the repo owner to post. Nothing here has been published
> anywhere.** Fill the two placeholders, check the claims against reality at the
> moment of posting, then post it yourself.

**Placeholders to fill before posting**

| Placeholder | What goes there |
|---|---|
| `<REPO_URL>` | the public GitHub URL |
| `<VIDEO_URL>` | the demo recording (or attach the video natively — native video outperforms a link) |

**Check before you post — every claim below must still be true**

- [ ] Repo is public and the README renders.
- [ ] `npm test` still passes on a clean clone (29 unit + 5 fork).
- [ ] The demo video shows what the copy says it shows.
- [ ] **If the Sepolia deploy has not happened, do not imply it has.** No variant
      below claims a live deployment; keep it that way, or add the addresses once
      they exist.
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
> Same screen, one switch, both truths 👇
>
> <VIDEO_URL>
> <REPO_URL>

*Notes:* leads with the insight, not the tech. The video does the selling. Under 280
characters with both links.

---

## Variant B — the money-shot post (single post, video-first)

> Same contract. Same storage slots. Two readers.
>
> Left: what anyone reading Sepolia sees — a 32-byte handle where each salary should
> be. Right: what one authorised account sees after a single gasless signature.
>
> Confidential payroll streaming on @iEx_ec Nox. No fork of Sablier required.
>
> <REPO_URL>

*Notes:* use this one if the video opens on the Public/Private toggle. "Left / right"
assumes a side-by-side cut; change to "before / after the switch" if the recording is
a straight toggle.

---

## Variant C — thread (5 posts)

**1/**
> Every token-streaming payroll design has the same hole: salaries are public. You
> can read what each person earns and reconstruct a company's whole comp band from
> one stream list.
>
> NoxStream closes it without touching the streaming protocol. Here is how. 🧵
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
> 29 unit tests against a real Nox stack in Docker, plus 5 against real, unmodified
> Sablier Lockup v4.0 bytecode on a Sepolia fork.

**5/**
> Stated plainly, because overclaiming here would be easy: Nox gives
> **confidentiality, not anonymity**. Roster membership, the aggregate stream and
> the fact that an address claimed at time T are all public — on purpose.
>
> MIT, and the feedback we owe @iEx_ec is in the repo.
>
> <REPO_URL>

*Notes:* post 5 is the one that earns trust with people who actually read code, and
it is also the post most likely to get a reply from the iExec team — engineers
respond to honest limits.

---

## Suggested tags and hashtags

`@iEx_ec` in every variant. `@Sablier` only in thread post 2, where the claim about
them is specific and accurate. Two hashtags maximum, appended to the final post only:
`#confidentialcomputing` `#TEE`. Skip `#web3` and `#buildinpublic` — they add reach of
the wrong kind.

## Tone guardrails applied

- No numbers that were not measured. The only figures used are test counts and the
  Sablier release version, both verifiable in the repo.
- No claims of a live deployment while `packages/shared/src/deployments/sepolia.json`
  does not exist.
- No "revolutionary", no "game-changing", no implied endorsement by iExec or Sablier.
- The limitation (confidentiality ≠ anonymity) is in the thread rather than buried,
  because the audience that matters will check.
