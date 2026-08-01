// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {euint256, externalEuint256} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";

/**
 * @title INoxPayrollRegistry
 * @notice The confidential roster: who is on payroll, and at what rate.
 *
 * Salary rates are stored as `euint256` handles — 32-byte pointers to
 * ciphertext held off-chain by Nox. Reading `ratePerSecondOf` from the chain
 * returns a handle, not a number; turning it into a number requires an ACL
 * grant that only the employer and the employee themselves hold.
 *
 * ## What is and is not confidential
 *
 * Nox provides *confidentiality, not anonymity*. Concretely:
 *   - CONFIDENTIAL: every salary rate, every accrued amount, every claimed
 *     amount. These exist on-chain only as handles.
 *   - PUBLIC: the fact that an address is on the roster, and the fact that a
 *     transaction occurred. Membership is deliberately public so the aggregate
 *     stream stays auditable and composable.
 *
 * We state this explicitly rather than implying the chain leaks nothing at all.
 */
interface INoxPayrollRegistry {
    /// @dev `ratePerSecond` is indexed as a handle; it discloses no value.
    event AllocationSet(address indexed employee, euint256 indexed ratePerSecond);
    event AllocationRevoked(address indexed employee);
    event PayrollSet(address indexed payroll);

    error NotEmployer();
    error EmployeeIsZeroAddress();
    error AlreadyRegistered();
    error NotRegistered();

    /**
     * @notice Adds or updates an employee's encrypted salary rate.
     * @dev Employer-only. The rate is encrypted client-side and bound to this
     *      contract, so a handle minted for another contract cannot be replayed
     *      here.
     * @param employee        Payee address. Public by design.
     * @param encryptedRate   Wei-per-second of the payout asset, encrypted.
     * @param inputProof      Gateway proof that `encryptedRate` is legitimate.
     */
    function setAllocation(
        address employee,
        externalEuint256 encryptedRate,
        bytes calldata inputProof
    ) external returns (euint256 rate);

    /**
     * @notice Sets many allocations in one transaction.
     * @dev Batching is a privacy feature, not just a gas optimisation: one
     *      transaction that touches the whole roster reveals less about any
     *      individual hire than N separate ones.
     */
    function setAllocations(
        address[] calldata employees,
        externalEuint256[] calldata encryptedRates,
        bytes[] calldata inputProofs
    ) external;

    /**
     * @notice Stops future accrual for `employee`.
     * @dev Does not erase already-accrued entitlement — that stays claimable.
     */
    function revokeAllocation(address employee) external;

    /**
     * @notice Names the settlement contract permitted to compute on rate
     *         handles, and back-fills that ACL grant across the whole roster.
     * @dev Required by Nox's execution model, not a convenience. `claim()`
     *      evaluates `rate * elapsed` inside the TEE and NoxCompute checks the
     *      *calling contract* against the ACL of every operand; without this
     *      grant the multiplication reverts with `NotAllowed`. Granting a
     *      contract does not grant a human — decryption needs an EIP-712
     *      signature from the granted address, which a contract cannot produce.
     */
    function setPayroll(address payroll) external;

    /// @notice The settlement contract allowed to compute on rates. 0 if unset.
    function payroll() external view returns (address);

    /// @notice Encrypted per-second rate. Returns a handle, never a value.
    function ratePerSecondOf(address employee) external view returns (euint256);

    /// @notice Whether `employee` is on the roster. Public by design.
    function isRegistered(address employee) external view returns (bool);

    /**
     * @notice Whether `employee` is still accruing salary.
     * @dev Distinct from `isRegistered`. Revoking writes an encrypted zero rate
     *      but KEEPS the employee on the roster, because `claim()` gates on
     *      roster membership and removing them would strand salary they have
     *      already earned. So a revoked employee is `isRegistered == true`,
     *      `isActive == false`, and may still have a claimable balance.
     */
    function isActive(address employee) external view returns (bool);

    /// @notice Roster size. Public, so the aggregate stream can be audited.
    function employeeCount() external view returns (uint256);

    function employeeAt(uint256 index) external view returns (address);

    function employer() external view returns (address);
}
