// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// The settlement layer: one public stream in, N confidential salaries out.
//
// The treasury funds ONE ordinary, fully visible stream through `IStreamAdapter`.
// The underlying protocol - Sablier, Superfluid, whatever - is never modified and
// never even learns NoxStream exists; it sees a normal stream to a single
// recipient, so everything that composes with it keeps working. `harvest()` pulls
// the unlocked balance in and wraps it into cUSDC. From that point on every
// number is a handle.
//
// `claim()` is where the design earns its keep. The entitlement calculation -
// rate x elapsed, minus what has already been claimed, clamped to what the vault
// can actually pay - happens entirely on ciphertext inside the TEE, and the
// result moves as an encrypted ERC-7984 transfer. An observer sees that address X
// claimed at time T. Not how much. Not what X earns. Not how X compares to Y.
//
// Two rules from the Nox execution model shape every line below, and they happen
// to point in the same direction as the privacy requirement:
//
//   1. Plaintext and ciphertext cannot meet. There is no `mul(euint256, uint256)`,
//      so any public quantity (here: elapsed seconds) must be lifted with
//      `Nox.toEuint256` before it can touch a salary.
//   2. You cannot branch on encrypted data. `ebool` is a ciphertext, so
//      `require`/`if`/`revert` on it is not merely unavailable - it would be a
//      public side channel. A `claim()` that reverted on "insufficient
//      entitlement" would let anyone binary-search a salary by watching which
//      claims succeed. Everything conditional here is a `select`.

import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Nox, ebool, euint256} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";

import {ConfidentialPayoutToken} from "./ConfidentialPayoutToken.sol";
import {INoxPayrollRegistry} from "./interfaces/INoxPayrollRegistry.sol";
import {INoxStreamPayroll} from "./interfaces/INoxStreamPayroll.sol";
import {IStreamAdapter} from "./interfaces/IStreamAdapter.sol";

contract NoxStreamPayroll is INoxStreamPayroll, ReentrancyGuard {
    INoxPayrollRegistry private immutable _registry;
    IStreamAdapter private immutable _streamAdapter;
    ConfidentialPayoutToken private immutable _confidentialToken;

    /// @dev The public ERC-20 the stream pays out and the token wraps 1:1.
    IERC20 private immutable _payoutAsset;

    uint64 private _startedAt;
    uint64 private _epoch;

    /// @dev Public and identical in meaning for everyone: the wall-clock second
    ///      up to which this employee's accrual has been booked. Exposing it
    ///      leaks nothing - `block.timestamp` is public and so is the roster.
    ///      The salary is the secret, not the clock.
    mapping(address employee => uint64 at) public lastAccrualAt;

    mapping(address employee => euint256 accrued) private _accruedOf;
    mapping(address employee => euint256 claimed) private _claimedOf;

    /// @dev The adapter's payout asset is not what the confidential token wraps.
    error AssetMismatch();
    /// @dev A constructor argument was the zero address.
    error ZeroAddress();
    /// @dev The confidential vault holds no cUSDC at all, so no claim can settle.

    /**
     * @param registry_          Encrypted roster. Must already point at this
     *                           contract via `setPayroll`, or be pointed at it
     *                           immediately after deployment.
     * @param streamAdapter_     Seam onto the public streaming protocol.
     * @param confidentialToken_ ERC-7984 wrapper employees are paid in.
     */
    constructor(
        INoxPayrollRegistry registry_,
        IStreamAdapter streamAdapter_,
        ConfidentialPayoutToken confidentialToken_
    ) {
        if (
            address(registry_) == address(0) ||
            address(streamAdapter_) == address(0) ||
            address(confidentialToken_) == address(0)
        ) revert ZeroAddress();

        address asset = streamAdapter_.asset();
        // Checked once, at deploy, rather than discovered at the first harvest:
        // a mismatch here would mean wrapping an asset the stream never pays,
        // which fails as an opaque ERC-20 revert deep inside `wrap`.
        if (asset != confidentialToken_.underlying()) revert AssetMismatch();

        _registry = registry_;
        _streamAdapter = streamAdapter_;
        _confidentialToken = confidentialToken_;
        _payoutAsset = IERC20(asset);
    }

    // ============ Lifecycle ============

    /// @inheritdoc INoxStreamPayroll
    function start() external override returns (uint64) {
        if (msg.sender != _registry.employer()) revert NotEmployer();
        if (_startedAt != 0) revert AlreadyStarted();

        _startedAt = uint64(block.timestamp);
        emit PayrollStarted(_startedAt);
        return _startedAt;
    }

    // ============ Harvest ============

    /**
     * @inheritdoc INoxStreamPayroll
     * @dev Deliberately callable before `start()`: pre-funding the confidential
     *      vault is strictly good, and gating it would only let an offline
     *      employer strand employee funds.
     *
     *      This is the one place a plaintext amount is emitted, and that is the
     *      design rather than an oversight. The aggregate payroll total is
     *      public on purpose - it is what keeps the stream auditable and
     *      composable. Only the per-employee breakdown is secret. Batching also
     *      buys timing privacy: the fund movement an observer sees is one
     *      aggregate transfer per epoch, not one per salary.
     */
    function harvest() external override nonReentrant returns (uint256 publicAmount) {
        uint256 balanceBefore = _payoutAsset.balanceOf(address(this));
        _streamAdapter.harvest(address(this));

        // Measure what actually arrived instead of trusting the adapter's return
        // value. The adapter is a swappable, protocol-specific component; the
        // vault should not mint confidential claims against a number it did not
        // verify itself.
        publicAmount = _payoutAsset.balanceOf(address(this)) - balanceBefore;
        if (publicAmount == 0) revert NothingToHarvest();

        // Wrap 1:1 into cUSDC held by this contract. `wrap` pulls via
        // `transferFrom`, hence the approval. `forceApprove` handles the ERC-20s
        // that reject a non-zero-to-non-zero allowance change.
        SafeERC20.forceApprove(_payoutAsset, address(_confidentialToken), publicAmount);
        _confidentialToken.wrap(address(this), publicAmount);

        unchecked {
            _epoch += 1;
        }
        emit Harvested(publicAmount, _epoch);
    }

    // ============ Claim ============

    /**
     * @inheritdoc INoxStreamPayroll
     * @dev The full algorithm, all of it on ciphertext:
     *
     *        owed        = rate x elapsed                     (lifted, safeMul)
     *        accrued    += owed                               (safeAdd, clamped)
     *        entitlement = accrued - claimed                  (safeSub, clamped)
     *        payAmount   = min(entitlement, vaultBalance)     (le + select)
     *        claimed    += payAmount
     *        transfer payAmount of cUSDC to the employee
     *
     *      Every clamp is a `select`, never a `revert`. An employee whose
     *      entitlement is zero, or whose employer under-funded the vault, gets a
     *      transaction that succeeds and moves an encrypted zero. On-chain it is
     *      indistinguishable from a full-salary claim - which is the point.
     */
    function claim() external override nonReentrant returns (euint256 claimed) {
        address employee = msg.sender;

        // Both of these gate on PUBLIC state only - whether payroll has started,
        // and whether the address is on the (public) roster. Neither reveals
        // anything about an encrypted value, so reverting here is not a side
        // channel. Contrast with the encrypted comparisons below, which must
        // never revert.
        if (_startedAt == 0) revert PayrollNotStarted();
        if (!_registry.isRegistered(employee)) revert NotRegistered();

        euint256 accrued = _accrue(employee);
        euint256 claimedSoFar = _claimedOf[employee];

        // entitlement = accrued - claimed, floored at zero. `safeSub` returns an
        // encrypted underflow flag; we cannot read it, so we `select` on it. The
        // flag can only be false if bookkeeping is already inconsistent, and
        // paying zero is the safe interpretation.
        (ebool solvent, euint256 entitlement) = Nox.safeSub(accrued, claimedSoFar);
        entitlement = Nox.select(solvent, entitlement, Nox.toEuint256(0));

        // Clamp to what the vault actually holds, so an under-funded payroll
        // degrades into a partial payment rather than a revert. A revert would
        // announce "this employee's entitlement exceeds the vault balance",
        // which is a public inequality over a private number.
        euint256 vaultBalance = _confidentialToken.confidentialBalanceOf(address(this));
        if (!Nox.isInitialized(vaultBalance)) revert VaultUnfunded();
        ebool funded = Nox.le(entitlement, vaultBalance);
        euint256 payAmount = Nox.select(funded, entitlement, vaultBalance);

        // Book the payment before moving any value. `payAmount` is provably
        // <= the vault balance by the clamp above, so the ERC-7984 transfer
        // below cannot come up short and this debit cannot over-charge.
        (ebool ok, euint256 newClaimed) = Nox.safeAdd(claimedSoFar, payAmount);
        _claimedOf[employee] = Nox.select(ok, newClaimed, claimedSoFar);
        Nox.allowThis(_claimedOf[employee]);
        Nox.allow(_claimedOf[employee], employee);

        // Three grants on the fresh `payAmount` handle, each for a different
        // reason:
        //   - allowThis:      ERC7984 checks `isAllowed(amount, msg.sender)`.
        //   - allowTransient: the token contract evaluates the transfer itself,
        //                     so it needs its own grant. Transient because it is
        //                     only needed for the rest of this transaction - a
        //                     permanent grant would accumulate ACL state forever.
        //   - allow:          the employee, so they can decrypt the handle in the
        //                     `ConfidentialClaim` event and see what they were paid.
        Nox.allowThis(payAmount);
        Nox.allowTransient(payAmount, address(_confidentialToken));
        Nox.allow(payAmount, employee);

        _confidentialToken.confidentialTransfer(employee, payAmount);

        // NOTE: we intentionally book `payAmount` rather than the handle
        // `confidentialTransfer` returns. Under the optimized ERC-7984
        // primitives that return value is produced with no ACL grants at all, so
        // the caller cannot compute on it - see feedback.md.
        claimed = payAmount;

        // Handle only. An observer learns that someone claimed in this epoch.
        emit ConfidentialClaim(employee, claimed, _epoch);
    }

    /// @inheritdoc INoxStreamPayroll
    function settle(address employee) external override returns (euint256 accrued) {
        accrued = _accrue(employee);
    }

    // ============ Views ============

    /// @inheritdoc INoxStreamPayroll
    function confidentialAccruedOf(address employee) external view override returns (euint256) {
        return _accruedOf[employee];
    }

    /// @inheritdoc INoxStreamPayroll
    function confidentialClaimedOf(address employee) external view override returns (euint256) {
        return _claimedOf[employee];
    }

    /// @inheritdoc INoxStreamPayroll
    function confidentialToken() external view override returns (address) {
        return address(_confidentialToken);
    }

    /// @inheritdoc INoxStreamPayroll
    function registry() external view override returns (address) {
        return address(_registry);
    }

    /// @inheritdoc INoxStreamPayroll
    function streamAdapter() external view override returns (address) {
        return address(_streamAdapter);
    }

    /// @inheritdoc INoxStreamPayroll
    function startedAt() external view override returns (uint64) {
        return _startedAt;
    }

    /// @inheritdoc INoxStreamPayroll
    function currentEpoch() external view override returns (uint64) {
        return _epoch;
    }

    /// @notice The public ERC-20 the stream pays out and cUSDC wraps.
    function payoutAsset() external view returns (address) {
        return address(_payoutAsset);
    }

    // ============ Internal ============

    /**
     * @dev Rolls `employee`'s encrypted accrual forward to now.
     *
     *      `elapsed` is public and identical for everyone, so computing it in
     *      plaintext costs nothing in privacy. It must still be *lifted* with
     *      `Nox.toEuint256` before it can meet the rate: Nox has no mixed
     *      plaintext/ciphertext arithmetic, so `mul(euint256, uint256)` does not
     *      exist and there is no implicit promotion to fall back on.
     */
    function _accrue(address employee) private returns (euint256 accrued) {
        accrued = _accruedOf[employee];

        uint64 nowTs = uint64(block.timestamp);
        uint64 last = lastAccrualAt[employee];
        uint64 startTs = _startedAt;

        // First touch, or payroll not running yet: anchor the clock and stop.
        // Anchoring on first touch is what stops a new hire from being paid for
        // the years before they joined.
        if (startTs == 0 || last == 0) {
            lastAccrualAt[employee] = nowTs;
            return accrued;
        }

        // Accrue from the later of {payroll start, last settlement}. Employees
        // anchored before `start()` must not be paid for the pre-start gap.
        uint64 from = last < startTs ? startTs : last;
        lastAccrualAt[employee] = nowTs;
        if (nowTs <= from) return accrued;

        euint256 rate = _registry.ratePerSecondOf(employee);
        if (!Nox.isInitialized(rate)) return accrued;

        // safeMul, not mul: a rate large enough to overflow 2**256 over the
        // elapsed window would otherwise wrap around to a small number and
        // silently underpay. We cannot read the overflow flag, so we select an
        // encrypted zero on failure - accrual stalls visibly rather than paying
        // a wrong amount.
        (ebool mulOk, euint256 owed) = Nox.safeMul(rate, Nox.toEuint256(nowTs - from));
        owed = Nox.select(mulOk, owed, Nox.toEuint256(0));

        (ebool addOk, euint256 updated) = Nox.safeAdd(accrued, owed);
        accrued = Nox.select(addOk, updated, accrued);

        _accruedOf[employee] = accrued;

        // The new handle belongs to nobody until granted. `this` needs it for the
        // next accrual and for `claim`'s subtraction; the employee needs it to
        // decrypt their own running total. Nobody else is granted, so nobody else
        // can ask the gateway to open it.
        Nox.allowThis(accrued);
        Nox.allow(accrued, employee);
    }
}
