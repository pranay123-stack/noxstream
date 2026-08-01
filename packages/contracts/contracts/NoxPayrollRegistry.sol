// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// The confidential roster. It stores one number per employee - a per-second
// salary rate - and that number never exists on-chain as a number. It exists as
// an `euint256` handle: a 32-byte pointer to ciphertext that only Nox's TEE can
// open, and only for addresses this contract has explicitly granted.
//
// Everything else here is deliberately public: who is on the roster, how many
// people are on it, who the employer is. That is the whole trade in NoxStream -
// the aggregate payroll stays auditable and composable, the per-person
// breakdown does not. Pretending the roster is secret too would be a lie an
// observer could disprove in one `eth_getLogs` call.

import {Nox, euint256, externalEuint256} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";
import {INoxPayrollRegistry} from "./interfaces/INoxPayrollRegistry.sol";
import {INoxStreamPayroll} from "./interfaces/INoxStreamPayroll.sol";

contract NoxPayrollRegistry is INoxPayrollRegistry {
    /// @dev Immutable: the employer is the root of trust for salary data, and a
    ///      transferable owner would let a compromised key silently redirect
    ///      decryption rights over every rate in the roster.
    address private immutable _employer;

    /// @dev The settlement contract allowed to *compute* on rate handles.
    address private _payroll;

    mapping(address employee => euint256 ratePerSecond) private _rateOf;
    mapping(address employee => bool) private _onRoster;
    mapping(address employee => bool) private _active;
    address[] private _roster;

    /// @dev `setAllocations` was called with mismatched array lengths.
    error ArrayLengthMismatch();
    /// @dev `employeeAt` was called past the end of the roster.
    error IndexOutOfBounds();
    /// @dev `setPayroll` was called with the zero address.
    error PayrollIsZeroAddress();

    modifier onlyEmployer() {
        if (msg.sender != _employer) revert NotEmployer();
        _;
    }

    /**
     * @param employer_ The address permitted to write allocations. It also
     *        receives an ACL grant on every rate handle, because an employer
     *        that cannot read back what it just wrote cannot audit its own
     *        payroll.
     */
    constructor(address employer_) {
        if (employer_ == address(0)) revert NotEmployer();
        _employer = employer_;
    }

    // ============ Employer writes ============

    /// @inheritdoc INoxPayrollRegistry
    function setAllocation(
        address employee,
        externalEuint256 encryptedRate,
        bytes calldata inputProof
    ) external override onlyEmployer returns (euint256 rate) {
        // `fromExternal` verifies the gateway proof and that the ciphertext was
        // minted *for this contract*. A handle encrypted against a different
        // application contract cannot be replayed here.
        rate = _writeAllocation(employee, Nox.fromExternal(encryptedRate, inputProof));
    }

    /// @inheritdoc INoxPayrollRegistry
    function setAllocations(
        address[] calldata employees,
        externalEuint256[] calldata encryptedRates,
        bytes[] calldata inputProofs
    ) external override onlyEmployer {
        uint256 length = employees.length;
        if (length != encryptedRates.length || length != inputProofs.length) {
            revert ArrayLengthMismatch();
        }
        for (uint256 i; i < length; ++i) {
            _writeAllocation(employees[i], Nox.fromExternal(encryptedRates[i], inputProofs[i]));
        }
    }

    /// @inheritdoc INoxPayrollRegistry
    function revokeAllocation(address employee) external override onlyEmployer {
        if (!_onRoster[employee]) revert NotRegistered();

        // Settle first, at the OLD rate, for the seconds actually worked. If we
        // zeroed the rate before settling, every unclaimed second between the
        // last touch and now would silently evaporate.
        _settleBeforeRateChange(employee);

        // Revoke by writing an encrypted zero rather than deleting the entry.
        // Deleting would drop the employee off the roster, and `claim()` gates
        // on roster membership - a leaver would lose salary they had already
        // earned but not yet claimed. Accrual stops; entitlement survives.
        //
        // NOTE: `Nox.toEuint256` mints a *public* handle (it wraps a plaintext
        // constant), so a revoked rate is openly readable as zero. That leaks
        // nothing new: `AllocationRevoked` below is a public event anyway.
        euint256 zeroRate = Nox.toEuint256(0);
        _rateOf[employee] = zeroRate;
        _active[employee] = false;
        _grantRateAccess(zeroRate, employee);

        emit AllocationRevoked(employee);
    }

    /**
     * @notice Points the registry at the settlement contract that is allowed to
     *         compute on rate handles, and back-fills that grant across the
     *         existing roster.
     * @dev This exists because of how Nox's ACL works, not as a convenience.
     *      `NoxStreamPayroll.claim()` evaluates `rate * elapsed` inside the TEE;
     *      NoxCompute checks that *the calling contract* is allowed on every
     *      operand. Without this grant the multiplication reverts with
     *      `NotAllowed` - and it reverts inside `claim()`, nowhere near the
     *      `setAllocation` that actually caused it.
     *
     *      Granting a contract is not the same as granting a person. Decryption
     *      requires an EIP-712 signature from the granted address, and
     *      `NoxStreamPayroll` has no code path that signs, reveals, or calls
     *      `allowPublicDecryption`. It can compute on salaries; it cannot read
     *      them out.
     *
     *      Re-pointing at a new settlement contract re-grants the whole roster,
     *      so allocations may be written before or after this call. Cost is
     *      linear in roster size - fine for a payroll, not for a million rows.
     * @param payroll_ The `INoxStreamPayroll` deployment for this registry.
     */
    function setPayroll(address payroll_) external override onlyEmployer {
        if (payroll_ == address(0)) revert PayrollIsZeroAddress();
        _payroll = payroll_;

        uint256 length = _roster.length;
        for (uint256 i; i < length; ++i) {
            address employee = _roster[i];
            // Grant before settling, never after: `settle` computes on the rate,
            // and NoxCompute rejects the multiplication if the caller is not yet
            // allowed on the operand.
            Nox.allow(_rateOf[employee], payroll_);
            // Anchor each existing employee's accrual clock in the settlement
            // contract. Without this, anyone allocated before `setPayroll` would
            // have an unanchored clock and silently lose the first stretch of
            // accrual.
            INoxStreamPayroll(payroll_).settle(employee);
        }

        emit PayrollSet(payroll_);
    }

    // ============ Views ============

    /// @inheritdoc INoxPayrollRegistry
    function ratePerSecondOf(address employee) external view override returns (euint256) {
        return _rateOf[employee];
    }

    /// @inheritdoc INoxPayrollRegistry
    function isRegistered(address employee) external view override returns (bool) {
        return _onRoster[employee];
    }

    /**
     * @notice Whether `employee` is still accruing salary.
     * @dev Distinct from {isRegistered}. A revoked employee stays *registered*
     *      (so they can still claim what they earned) but is no longer
     *      *active* (their encrypted rate is zero, so nothing further accrues).
     */
    function isActive(address employee) external view returns (bool) {
        return _active[employee];
    }

    /// @inheritdoc INoxPayrollRegistry
    function employeeCount() external view override returns (uint256) {
        return _roster.length;
    }

    /// @inheritdoc INoxPayrollRegistry
    function employeeAt(uint256 index) external view override returns (address) {
        if (index >= _roster.length) revert IndexOutOfBounds();
        return _roster[index];
    }

    /// @inheritdoc INoxPayrollRegistry
    function employer() external view override returns (address) {
        return _employer;
    }

    /// @inheritdoc INoxPayrollRegistry
    function payroll() external view override returns (address) {
        return _payroll;
    }

    // ============ Internal ============

    function _writeAllocation(address employee, euint256 rate) private returns (euint256) {
        if (employee == address(0)) revert EmployeeIsZeroAddress();

        // Accrue everything owed at the previous rate before the new one lands,
        // otherwise a mid-month raise would retroactively re-price every second
        // already worked. For a brand-new hire this call just anchors their
        // accrual clock to now, so they get no back-pay for time before they
        // existed on the roster.
        _settleBeforeRateChange(employee);

        if (!_onRoster[employee]) {
            _onRoster[employee] = true;
            _roster.push(employee);
        }
        _active[employee] = true;
        _rateOf[employee] = rate;

        _grantRateAccess(rate, employee);

        // The event carries the handle, never the value. An observer learns
        // that this employee's compensation changed, not what it changed to.
        emit AllocationSet(employee, rate);
        return rate;
    }

    /**
     * @dev Every handle produced by a Nox operation starts out accessible to
     *      nobody - not even to the contract that produced it. These four grants
     *      are the complete set of parties that may touch a rate:
     *        - this contract, so it can re-grant the handle later;
     *        - the employee, the only human who may decrypt their own salary;
     *        - the employer, who wrote it and must be able to audit it;
     *        - the settlement contract, which computes on it but cannot read it.
     *      Anyone else asking the gateway to decrypt this handle is refused.
     */
    function _grantRateAccess(euint256 rate, address employee) private {
        Nox.allowThis(rate);
        Nox.allow(rate, employee);
        Nox.allow(rate, _employer);

        address payroll_ = _payroll;
        if (payroll_ != address(0)) {
            Nox.allow(rate, payroll_);
        }
    }

    /// @dev No-op until {setPayroll} has been called, which keeps the registry
    ///      deployable and populatable before the settlement contract exists.
    function _settleBeforeRateChange(address employee) private {
        address payroll_ = _payroll;
        if (payroll_ != address(0)) {
            INoxStreamPayroll(payroll_).settle(employee);
        }
    }
}
