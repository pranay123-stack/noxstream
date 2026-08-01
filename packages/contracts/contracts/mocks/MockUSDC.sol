// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDC
 * @notice A 6-decimal ERC-20 faucet token used as the **testnet stand-in for
 *         USDC** on Ethereum Sepolia.
 *
 * ## Why this exists, and why it is not "mock data"
 *
 * There is no canonical, freely-mintable USDC on Sepolia. Every part of the
 * NoxStream demo that touches this token is real: real ERC-20 transfers, a real
 * Sablier Lockup stream denominated in it, real ERC-7984 confidential wrapping.
 * Only the *issuer* is a faucet instead of Circle. Anyone can mint it, so
 * reviewers can reproduce the whole flow without begging for testnet USDC.
 *
 * It matches USDC's shape where that matters:
 *   - 6 decimals (so 1_000_000 == 1.00 USDC, and every amount in the demo reads
 *     the same as it would on mainnet)
 *   - plain, standard-compliant ERC-20 — no fee-on-transfer, no rebasing
 *
 * ## Deploying against real USDC
 *
 * Nothing in NoxStream depends on this contract. `SablierStreamAdapter` takes
 * its payout asset as a constructor argument, so the deploy path must use a
 * supplied real USDC address when one is given and only fall back to deploying
 * this when it is not. On mainnet or on a chain with canonical USDC, pass that
 * address and this file is never deployed at all.
 *
 * NOT FOR PRODUCTION: `mint` is intentionally unrestricted.
 */
contract MockUSDC is ERC20 {
    /// @dev USDC is 6-decimal. Matching it keeps every amount in the demo
    ///      identical to what a mainnet deployment would use.
    uint8 private constant _DECIMALS = 6;

    constructor() ERC20("USD Coin (NoxStream testnet)", "USDC") {}

    /// @inheritdoc ERC20
    function decimals() public pure override returns (uint8) {
        return _DECIMALS;
    }

    /**
     * @notice Public faucet. Anyone may mint to anyone.
     * @dev Unrestricted on purpose: a hackathon reviewer must be able to run the
     *      end-to-end flow without a whitelist. This is the single reason this
     *      contract is testnet-only.
     * @param to     Recipient of the newly minted tokens.
     * @param amount Amount in base units (6 decimals — 1_000_000 == 1.00 USDC).
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
