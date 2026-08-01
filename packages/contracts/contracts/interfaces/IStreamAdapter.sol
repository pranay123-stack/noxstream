// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IStreamAdapter
 * @notice The composability seam between NoxStream and a public streaming
 *         protocol (Sablier, Superfluid, ...).
 *
 * NoxStream never modifies the underlying protocol. It funds ONE ordinary,
 * fully public aggregate stream through this adapter and then harvests the
 * unlocked balance into the confidential vault. To an outside observer — and to
 * every other contract that composes with that protocol — the stream is just a
 * normal stream from a treasury to a single recipient.
 *
 * Keeping this an interface (rather than importing Sablier directly into the
 * payroll contract) means the confidential layer is protocol-agnostic: swapping
 * Sablier for Superfluid is a deploy-time choice, not a rewrite.
 *
 * IMPORTANT: everything in this interface is PUBLIC and unencrypted on purpose.
 * The aggregate payroll total is not a secret — only its per-employee breakdown
 * is. That split is the whole design.
 */
interface IStreamAdapter {
    event StreamFunded(uint256 indexed streamId, uint256 totalAmount, uint40 duration);
    event StreamHarvested(uint256 indexed streamId, address indexed to, uint256 amount);

    error NotTreasury();
    error StreamAlreadyOpen();
    error NoStream();

    /// @notice The public ERC-20 being streamed (payout asset, e.g. USDC).
    function asset() external view returns (address);

    /**
     * @notice Opens the single aggregate payroll stream.
     * @dev Pulls `totalAmount` of `asset()` from the caller, so the caller must
     *      have approved this adapter first. The recipient is the NoxStream
     *      vault, set at construction.
     * @return streamId Identifier in the underlying protocol.
     */
    function fundStream(uint256 totalAmount, uint40 duration) external returns (uint256 streamId);

    /**
     * @notice Amount currently unlocked by the stream and not yet harvested.
     * @dev Public — this is the aggregate figure, which is meant to be visible.
     */
    function withdrawableAmount() external view returns (uint256);

    /**
     * @notice Moves unlocked funds from the public stream into `to`.
     * @dev Permissionless: anyone may push funds toward the vault, which keeps
     *      employees from depending on the employer being online.
     * @return amount Units of `asset()` actually moved.
     */
    function harvest(address to) external returns (uint256 amount);

    /// @notice Underlying protocol's stream id. 0 when no stream is open.
    function streamId() external view returns (uint256);

    /// @notice Human-readable tag, e.g. "sablier-lockup-linear-v2.0".
    function protocolTag() external view returns (string memory);
}
