// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// cUSDC: the asset employees are actually paid in.
//
// The obvious payroll design - compute the salary inside the TEE, then send
// plain USDC - leaks everything at the final step, because an ERC-20 `Transfer`
// carries a public amount. Anyone watching the vault would read every salary off
// the transfer log while the "confidential" computation sat uselessly upstream.
//
// So the payout asset inside NoxStream is this: an ERC-7984 confidential token
// that wraps the public payout ERC-20 1:1. Balances and transfer amounts are
// `euint256` handles from mint to claim. Privacy ends only where the employee
// chooses to end it, by calling `unwrap` and taking public USDC back out.
//
// There is deliberately no mint authority and no owner. Wrapping is
// permissionless and fully collateralised - every cUSDC in existence is backed
// by a real unit of `underlying()` sitting in this contract. A privileged minter
// would make the confidential supply unauditable, which is exactly the property
// a confidential token cannot afford to lose.

import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {ERC20ToERC7984Wrapper} from "@iexec-nox/nox-confidential-contracts/contracts/token/extensions/ERC20ToERC7984Wrapper.sol";
import {Nox, euint256} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";

contract ConfidentialPayoutToken is ERC20ToERC7984Wrapper {
    /// @dev The underlying ERC-20 was the zero address.
    error UnderlyingIsZeroAddress();

    /**
     * @param name_        Display name, e.g. "Confidential USDC".
     * @param symbol_      Display symbol, e.g. "cUSDC".
     * @param contractURI_ ERC-7984 metadata URI. May be empty.
     * @param underlying_  The public payout ERC-20 being wrapped 1:1. `decimals`
     *                     is inherited from it, so no rate conversion is needed
     *                     and no precision is lost - this implementation stores
     *                     amounts as `euint256`, wide enough for any ERC-20.
     */
    constructor(
        string memory name_,
        string memory symbol_,
        string memory contractURI_,
        IERC20 underlying_
    ) ERC20ToERC7984Wrapper(name_, symbol_, contractURI_, underlying_) {
        if (address(underlying_) == address(0)) revert UnderlyingIsZeroAddress();
    }

    /**
     * @dev Re-grants this contract's ACL on the total-supply handle after every
     *      mint, burn and transfer.
     *
     *      This override is the one non-obvious line in the contract, and it is
     *      load-bearing. Total supply is itself a ciphertext, and every Nox
     *      operation returns a *fresh* handle that nobody - including the
     *      contract that just produced it - is allowed to touch. The optimized
     *      mint/burn primitives do not reliably persist that grant, so without
     *      this line the FIRST wrap succeeds and the SECOND reverts with
     *      `NotAllowed` when it tries to read the supply it can no longer
     *      access. The failure surfaces far from its cause and looks like a
     *      gateway problem rather than an ACL one; the official Nox starter's
     *      `ConfidentialToken` carries the identical override for the identical
     *      reason.
     *
     *      `allow` is idempotent and skips public handles, so re-granting
     *      unconditionally is cheap insurance rather than a behaviour change -
     *      and it keeps this contract correct across package versions instead of
     *      depending on which primitives the base class happens to use today.
     */
    function _update(
        address from,
        address to,
        euint256 amount
    ) internal virtual override returns (euint256 transferred) {
        transferred = super._update(from, to, amount);
        Nox.allowThis(confidentialTotalSupply());
    }
}
