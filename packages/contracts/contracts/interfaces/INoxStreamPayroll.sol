// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {euint256} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";

/**
 * @title INoxStreamPayroll
 * @notice Confidential settlement against a public aggregate stream.
 *
 * ## Flow
 *   1. Treasury funds ONE public stream via `IStreamAdapter` (visible, normal).
 *   2. `harvest()` pulls unlocked public ERC-20 into this contract and wraps it
 *      into the confidential ERC-7984 payout token (cUSDC).
 *   3. An employee calls `claim()`. Inside the Nox TEE the contract computes
 *      their encrypted entitlement, clamps it to what is actually available,
 *      and moves encrypted cUSDC to them. No amount is ever revealed.
 *
 * ## Why a claim can never revert on "insufficient entitlement"
 *
 * A revert is a public, observable side channel. If `claim()` reverted when an
 * employee asked for more than they had earned, an observer could binary-search
 * the salary by watching which claims succeed. Nox cannot branch on encrypted
 * data anyway (`ebool` is a ciphertext, not a `bool`), so the contract uses the
 * `safeSub` + `select` clamp pattern instead: an over-claim silently settles to
 * the correct lower amount and looks identical on-chain to any other claim.
 * The privacy requirement and the Nox execution model point the same way here.
 */
interface INoxStreamPayroll {
    /// @dev Carries a handle, not a value. Observers learn "someone claimed",
    ///      never how much.
    event ConfidentialClaim(address indexed employee, euint256 indexed amount, uint64 epoch);
    event Harvested(uint256 publicAmount, uint64 epoch);
    event PayrollStarted(uint64 startedAt);

    error NotRegistered();
    error PayrollNotStarted();
    error NothingToHarvest();
    error NotEmployer();
    error AlreadyStarted();
    /// @dev Raised when nothing has been harvested yet, so the vault holds no
    ///      confidential balance handle to clamp against. This gates on PUBLIC
    ///      state (has a harvest ever happened), not on any encrypted value.
    error VaultUnfunded();

    /**
     * @notice Settles the caller's accrued salary confidentially.
     * @dev Permissionless per-caller; entitlement is enforced in ciphertext.
     * @return claimed Encrypted amount actually transferred (a handle).
     */
    function claim() external returns (euint256 claimed);

    /**
     * @notice Pulls unlocked funds from the public stream and wraps them.
     * @dev Permissionless and batched across all employees, so the public trace
     *      is one aggregate movement rather than N per-salary movements.
     */
    function harvest() external returns (uint256 publicAmount);

    /**
     * @notice Begins accrual. Employer-only, callable once.
     * @dev Separate from deployment so the treasury can fund the public stream
     *      first. Nobody accrues salary against a vault that cannot pay.
     */
    function start() external returns (uint64 startedAt);

    /**
     * @notice Rolls `employee`'s encrypted accrual forward to `block.timestamp`.
     * @dev Permissionless — it can only ever credit an employee for seconds
     *      they have already worked, so there is nothing to grief. The registry
     *      calls it immediately before any rate change: accrual must be booked
     *      at the OLD rate, or a raise would retroactively re-price every second
     *      already worked.
     * @return accrued The employee's total encrypted accrual (a handle).
     */
    function settle(address employee) external returns (euint256 accrued);

    /// @notice Encrypted total accrued for `employee` since payroll start.
    function confidentialAccruedOf(address employee) external view returns (euint256);

    /// @notice Encrypted total already claimed by `employee`.
    function confidentialClaimedOf(address employee) external view returns (euint256);

    /// @notice The ERC-7984 confidential payout token employees receive.
    function confidentialToken() external view returns (address);

    /// @notice The public ERC-20 that is streamed in and wrapped. Public.
    function payoutAsset() external view returns (address);

    /**
     * @notice Unix time `employee`'s accrual was last rolled forward.
     * @dev Public, and deliberately so: it is a timestamp, not an amount. It
     *      reveals that a settlement touched this employee, never how much.
     */
    function lastAccrualAt(address employee) external view returns (uint64);

    function registry() external view returns (address);

    function streamAdapter() external view returns (address);

    /// @notice Unix time accrual began. Public — it is the same for everyone.
    function startedAt() external view returns (uint64);

    /// @notice Monotonic settlement epoch, bumped on harvest.
    function currentEpoch() external view returns (uint64);
}
