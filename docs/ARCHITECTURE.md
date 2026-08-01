# NoxStream architecture

## The problem

Token streaming (Sablier, Superfluid) is excellent infrastructure with one
property that makes it unusable for real payroll: **every salary is public**.
Anyone can read what each employee earns, when they claim, and infer the whole
compensation band of a company from its stream list.

The naive fix — move payroll off-chain — throws away composability. NoxStream
keeps the public stream exactly as it is and moves only the *breakdown* into
Nox's TEE.

## The split

```
                    PUBLIC (deliberately visible, fully composable)
  ┌──────────────────────────────────────────────────────────────────┐
  │  Treasury ──funds ONE aggregate stream──► Sablier/Superfluid     │
  │                                              │                    │
  │                                    harvest() │ unlocked USDC      │
  └──────────────────────────────────────────────┼────────────────────┘
                                                 ▼
                        ┌────────────────────────────────────────┐
                        │  NoxStreamPayroll                      │
                        │  wraps USDC ──► cUSDC (ERC-7984)       │
                        └────────────────────────────────────────┘
                                                 │
                    CONFIDENTIAL (handles only, computed in TEE)
  ┌──────────────────────────────────────────────┼────────────────────┐
  │  NoxPayrollRegistry: employee ─► euint256 ratePerSecond           │
  │  Accrual:  owed = rate x elapsed        (all ciphertext)          │
  │  claim():  clamp to available, transfer encrypted cUSDC           │
  └──────────────────────────────────────────────────────────────────┘
                                                 ▼
                                     Employee decrypts own balance
                                     (ACL grant + EIP-712, gasless)
```

The underlying streaming protocol is **never modified and never even aware of
NoxStream**. It sees one ordinary stream to one recipient. Every other protocol
that composes with it keeps working.

## Why the payout is a confidential token, not raw USDC

The obvious design — compute the salary in the TEE, then send plain USDC — leaks
everything at the last step, because an ERC-20 `Transfer` carries a public
amount. So the payout asset inside NoxStream is **cUSDC**, an ERC-7984
confidential token wrapping real USDC 1:1. Claims move encrypted balances; the
amount is a handle at every point.

Converting back to public USDC is a deliberate, employee-controlled exit
(`unwrap`, two-phase and asynchronous). Privacy ends where the employee chooses
to end it, not where the protocol forces it to.

## Privacy model — stated honestly

Nox gives **confidentiality, not anonymity**. Overclaiming here would be easy
and wrong, so:

| Fact | Visible? |
|---|---|
| Individual salary rate | **No** — `euint256` handle |
| Individual accrued / claimed / balance | **No** — handles |
| Claim amount | **No** — never appears, not even in events |
| Aggregate stream size and schedule | Yes — intentional, keeps it auditable |
| Roster membership (which addresses are employees) | Yes |
| That address X sent a claim tx at time T | Yes |

Claim *timing* is mitigated, not eliminated: settlement is epoch-batched and
`harvest()` is permissionless, so the fund movement an observer sees is one
aggregate transfer per epoch rather than one per salary. Full timing anonymity
would need a relayer or account abstraction; that is named as future work rather
than implied to exist.

## Contracts

| Contract | Role |
|---|---|
| `NoxPayrollRegistry` | Encrypted roster: employee → `euint256` rate/second |
| `NoxStreamPayroll` | Accrual, clamped confidential claim, harvest + wrap |
| `ConfidentialPayoutToken` | ERC-7984 cUSDC wrapping the public payout asset |
| `SablierStreamAdapter` | `IStreamAdapter` impl over the public stream |

Interfaces live in `packages/contracts/contracts/interfaces/` and are the
coordination contract between workstreams.

## The claim, precisely

```solidity
// elapsed is public; lift it before it can meet ciphertext
euint256 owed    = Nox.mul(rate, Nox.toEuint256(elapsed));
euint256 accrued = Nox.add(accruedOf[employee], owed);

// entitlement = accrued - claimed, clamped at zero
(ebool solvent, euint256 entitlement) = Nox.safeSub(accrued, claimedOf[employee]);
entitlement = Nox.select(solvent, entitlement, Nox.toEuint256(0));

// pay out, then re-grant ACLs on every new handle
```

No step can `revert` on an encrypted condition — that would be a public side
channel disclosing the comparison result. Over-claims settle silently to the
correct amount and are indistinguishable on-chain from any other claim.
