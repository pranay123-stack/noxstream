// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// Real protocol interfaces, imported from Sablier's own npm package
// (`@sablier/lockup@4.0.1`) rather than hand-copied. Nothing here is a
// reimplementation: we only *call* the deployed Lockup contract.
import {ISablierLockup} from "@sablier/lockup/src/interfaces/ISablierLockup.sol";
import {Lockup} from "@sablier/lockup/src/types/Lockup.sol";
import {LockupLinear} from "@sablier/lockup/src/types/LockupLinear.sol";

import {IStreamAdapter} from "../interfaces/IStreamAdapter.sol";

/**
 * @title SablierStreamAdapter
 * @notice `IStreamAdapter` over the **live, unmodified** Sablier Lockup
 *         protocol (release v4.0) on Ethereum Sepolia.
 *
 * Ethereum Sepolia (11155111) SablierLockup: 0xe61cb9153356419bdaD0A8767c059f92d221a3C4
 * — verified live; see `docs/STREAM_PROTOCOL.md` for the raw evidence. The
 * address is NOT hardcoded here: it is a constructor argument, so the same
 * bytecode works against any Sablier deployment (or a fork) without an edit.
 *
 * ## What this contract is, and what it deliberately is not
 *
 * NoxStream never forks, patches or wraps Sablier's *logic*. It opens ONE
 * ordinary Sablier Lockup Linear stream and reads/withdraws from it through the
 * public interface. Sablier has no idea NoxStream exists; every other protocol
 * composing with Sablier keeps working, and the stream shows up in Sablier's own
 * UI, subgraph and NFT like any other.
 *
 * Everything in this contract is PUBLIC and unencrypted **on purpose**. The
 * aggregate payroll total and its schedule are meant to be auditable. Only the
 * per-employee breakdown is confidential, and that lives one layer up in the
 * Nox TEE contracts. Do not add encryption here — it would defeat the point.
 *
 * ## Two design decisions that are load-bearing
 *
 * 1. **The adapter is the Sablier recipient, not the vault.**
 *    `IStreamAdapter.harvest(address to)` must be able to route unlocked funds
 *    to a caller-chosen address. Sablier only lets a non-owner withdraw *to the
 *    stream's recipient*, so if the vault owned the stream NFT the adapter could
 *    never satisfy that signature. Making the adapter the on-chain recipient
 *    also means the confidential vault needs zero ERC-721 awareness. The
 *    *economic* recipient is still the vault — enforced by `harvest`'s
 *    destination guard below.
 *
 * 2. **`harvest` is permissionless, but its destination is not free-form.**
 *    Employees must never depend on the employer being online, so anyone may
 *    call `harvest`. An unrestricted `to` on a permissionless function is a
 *    drain, though, so: anyone may push funds to `VAULT`, and only `VAULT`
 *    itself may redirect them elsewhere (e.g. straight into the ERC-7984
 *    wrapper, saving a hop). Both real callers land on `to == VAULT`.
 *
 * ## The fee tank (a real property of Sablier v3.0+)
 *
 * Sablier Lockup v3.0 introduced a comptroller-set **minimum withdrawal fee
 * denominated in the native token**, charged on every `withdraw` regardless of
 * who calls it. On Sepolia it is currently ~0.000483 ETH. `IStreamAdapter.harvest`
 * is non-payable (Solidity forbids widening an interface's mutability), so the
 * adapter cannot forward a caller's `msg.value`. Instead it keeps its own ETH
 * balance — the "fee tank" — and pays out of it.
 *
 * The tank is topped up by *anyone* via `receive()`, which preserves the
 * trust-minimised property: if the employer lets it run dry, an employee (or a
 * bot) can refill it and harvest anyway. `minHarvestFeeWei()` reports the exact
 * amount a harvest needs so a UI can warn before it becomes a problem.
 */
contract SablierStreamAdapter is IStreamAdapter, IERC721Receiver, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /*//////////////////////////////////////////////////////////////////////////
                                      ERRORS
    //////////////////////////////////////////////////////////////////////////*/

    /// @notice A zero address was supplied where a real one is required.
    error ZeroAddress();
    /// @notice `duration` was zero; Sablier requires start < end.
    error ZeroDuration();
    /// @notice Sablier stores deposits as `uint128`; this amount does not fit.
    error AmountTooLarge(uint256 amount);
    /// @notice Permissionless harvest may only push to `VAULT`; only `VAULT`
    ///         may redirect the funds somewhere else.
    error UnauthorizedDestination(address to);
    /// @notice The ETH fee tank cannot cover Sablier's minimum withdrawal fee.
    error InsufficientFeeTank(uint256 required, uint256 available);
    /// @notice A raw ETH transfer failed.
    error EthTransferFailed();

    /*//////////////////////////////////////////////////////////////////////////
                                      EVENTS
    //////////////////////////////////////////////////////////////////////////*/

    /// @notice Someone topped up the ETH used to pay Sablier's withdrawal fee.
    event FeeTankFunded(address indexed from, uint256 amount);
    /// @notice The treasury reclaimed leftover fee-tank ETH.
    event FeeTankSwept(address indexed to, uint256 amount);

    /*//////////////////////////////////////////////////////////////////////////
                                     CONSTANTS
    //////////////////////////////////////////////////////////////////////////*/

    /**
     * @dev Sablier tags every stream with a free-form "shape" string (max 32
     *      bytes) that surfaces in its UI and subgraph. Labelling the stream
     *      makes the aggregate publicly identifiable as NoxStream payroll,
     *      which is exactly the transparency half of the design.
     */
    string internal constant _SHAPE = "noxstream-aggregate-payroll";

    /**
     * @dev Per-second unlock. Sablier v4 added a `granularity` parameter (the
     *      unlock step in seconds); 1 reproduces the classic continuous linear
     *      stream. Passing 0 would also be coerced to 1 by Sablier, but being
     *      explicit documents the intent.
     */
    uint40 internal constant _GRANULARITY = 1;

    /*//////////////////////////////////////////////////////////////////////////
                                     IMMUTABLES
    //////////////////////////////////////////////////////////////////////////*/

    /// @notice The live Sablier Lockup contract this adapter composes with.
    ISablierLockup public immutable LOCKUP;

    /// @notice Public payout ERC-20 being streamed (USDC on mainnet, MockUSDC on testnet).
    IERC20 public immutable ASSET;

    /// @notice The only address allowed to open the aggregate stream.
    address public immutable TREASURY;

    /// @notice NoxStream's confidential payroll vault — the economic recipient.
    address public immutable VAULT;

    /*//////////////////////////////////////////////////////////////////////////
                                       STORAGE
    //////////////////////////////////////////////////////////////////////////*/

    /// @dev Sablier stream id; 0 means no stream has been opened yet. Sablier
    ///      ids start at 1, so 0 is an unambiguous sentinel.
    uint256 private _streamId;

    /*//////////////////////////////////////////////////////////////////////////
                                     CONSTRUCTOR
    //////////////////////////////////////////////////////////////////////////*/

    /**
     * @param lockup_   Deployed SablierLockup (v3.0+ ABI). Not hardcoded so the
     *                  same bytecode works on any chain Sablier supports.
     * @param asset_    Public ERC-20 payout asset.
     * @param treasury_ Employer address permitted to open the stream.
     * @param vault_    NoxStreamPayroll — where harvested funds go.
     * @dev Payable so a deploy script can seed the fee tank in the same tx.
     */
    constructor(ISablierLockup lockup_, IERC20 asset_, address treasury_, address vault_) payable {
        if (
            address(lockup_) == address(0) || address(asset_) == address(0) || treasury_ == address(0)
                || vault_ == address(0)
        ) {
            revert ZeroAddress();
        }
        LOCKUP = lockup_;
        ASSET = asset_;
        TREASURY = treasury_;
        VAULT = vault_;

        if (msg.value > 0) emit FeeTankFunded(msg.sender, msg.value);
    }

    /*//////////////////////////////////////////////////////////////////////////
                                   IStreamAdapter
    //////////////////////////////////////////////////////////////////////////*/

    /// @inheritdoc IStreamAdapter
    function asset() external view returns (address) {
        return address(ASSET);
    }

    /// @inheritdoc IStreamAdapter
    function streamId() external view returns (uint256) {
        return _streamId;
    }

    /// @inheritdoc IStreamAdapter
    function protocolTag() external pure returns (string memory) {
        return "sablier-lockup-linear-v4.0";
    }

    /**
     * @inheritdoc IStreamAdapter
     * @dev Opens exactly one Sablier Lockup Linear stream. The caller must have
     *      approved this adapter for `totalAmount` first — Sablier pulls from
     *      `msg.sender`, which is this adapter, so the tokens make one hop
     *      through here and are never left sitting.
     *
     *      `cancelable: false` and `transferable: false` are deliberate. A
     *      non-cancelable stream is a credible commitment: once payroll is
     *      funded, neither the employer nor this adapter can claw it back, and
     *      there is no `cancel` path to exploit. A non-transferable NFT cannot
     *      be moved out of the adapter, so the entitlement is pinned here.
     */
    function fundStream(uint256 totalAmount, uint40 duration)
        external
        nonReentrant
        returns (uint256 newStreamId)
    {
        if (msg.sender != TREASURY) revert NotTreasury();
        if (_streamId != 0) revert StreamAlreadyOpen();
        if (duration == 0) revert ZeroDuration();
        // Sablier stores deposits as uint128. Fail loudly rather than truncate.
        if (totalAmount > type(uint128).max) revert AmountTooLarge(totalAmount);

        // Pull the payroll budget in from the treasury.
        ASSET.safeTransferFrom(msg.sender, address(this), totalAmount);

        // forceApprove (not approve) so non-standard ERC-20s such as USDT, which
        // revert on a non-zero -> non-zero allowance change, still work.
        ASSET.forceApprove(address(LOCKUP), totalAmount);

        newStreamId = LOCKUP.createWithDurationsLL({
            params: Lockup.CreateWithDurations({
                // `sender` is Sablier's cancel/refund authority. Pointing it at
                // this adapter — which exposes no cancel function — means no EOA
                // holds any privileged role over funded payroll.
                sender: address(this),
                // See the contract-level note: the adapter must own the stream
                // NFT for `harvest(to)` to be expressible.
                recipient: address(this),
                depositAmount: uint128(totalAmount),
                token: ASSET,
                cancelable: false,
                transferable: false,
                shape: _SHAPE
            }),
            // Nothing unlocks up front or at a cliff: a flat linear salary curve.
            unlockAmounts: LockupLinear.UnlockAmounts({start: 0, cliff: 0}),
            granularity: _GRANULARITY,
            durations: LockupLinear.Durations({cliff: 0, total: duration})
        });

        _streamId = newStreamId;
        emit StreamFunded(newStreamId, totalAmount, duration);
    }

    /**
     * @inheritdoc IStreamAdapter
     * @dev Delegates straight to Sablier's own accounting — this contract keeps
     *      no shadow copy of the unlock curve, so the number can never drift
     *      from what Sablier itself reports. Returns 0 before any stream exists
     *      because Sablier's `notNull` modifier would otherwise revert.
     */
    function withdrawableAmount() external view returns (uint256) {
        uint256 id = _streamId;
        if (id == 0) return 0;
        return uint256(LOCKUP.withdrawableAmountOf(id));
    }

    /**
     * @inheritdoc IStreamAdapter
     * @dev Permissionless. Withdraws to this adapter (Sablier requires the
     *      destination be the recipient unless the caller owns the stream, and
     *      here the adapter is both), then forwards the measured balance delta
     *      onward. Measuring the delta rather than trusting the requested amount
     *      keeps this correct for fee-on-transfer assets.
     */
    function harvest(address to) external nonReentrant returns (uint256 amount) {
        uint256 id = _streamId;
        if (id == 0) revert NoStream();
        if (to == address(0)) revert ZeroAddress();
        // Anyone may push to the vault; only the vault may redirect.
        if (to != VAULT && msg.sender != VAULT) revert UnauthorizedDestination(to);

        uint128 unlocked = LOCKUP.withdrawableAmountOf(id);
        // Sablier reverts on a zero-amount withdrawal. A no-op harvest should be
        // cheap and quiet, not a revert, since bots will poll this.
        if (unlocked == 0) return 0;

        // Sablier v3.0+ charges a native-token fee on every withdrawal.
        uint256 fee = LOCKUP.calculateMinFeeWei(id);
        if (fee > address(this).balance) {
            revert InsufficientFeeTank(fee, address(this).balance);
        }

        uint256 balanceBefore = ASSET.balanceOf(address(this));
        LOCKUP.withdraw{value: fee}({streamId: id, to: address(this), amount: unlocked});
        amount = ASSET.balanceOf(address(this)) - balanceBefore;

        ASSET.safeTransfer(to, amount);
        emit StreamHarvested(id, to, amount);
    }

    /*//////////////////////////////////////////////////////////////////////////
                                     FEE TANK
    //////////////////////////////////////////////////////////////////////////*/

    /// @notice ETH a single `harvest` currently needs. 0 when no stream is open.
    function minHarvestFeeWei() external view returns (uint256) {
        uint256 id = _streamId;
        if (id == 0) return 0;
        return LOCKUP.calculateMinFeeWei(id);
    }

    /// @notice ETH available to pay Sablier withdrawal fees.
    function feeTankBalance() external view returns (uint256) {
        return address(this).balance;
    }

    /// @notice Anyone may top up the fee tank — that is what keeps `harvest`
    ///         genuinely independent of the employer.
    receive() external payable {
        emit FeeTankFunded(msg.sender, msg.value);
    }

    /**
     * @notice Reclaim leftover fee-tank ETH.
     * @dev Treasury-only, and deliberately the *only* privileged function here.
     *      It can move ETH and nothing else: it cannot touch the payroll asset,
     *      the stream, or the vault's entitlement.
     */
    function sweepFeeTank(address to) external returns (uint256 amount) {
        if (msg.sender != TREASURY) revert NotTreasury();
        if (to == address(0)) revert ZeroAddress();

        amount = address(this).balance;
        if (amount == 0) return 0;

        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert EthTransferFailed();
        emit FeeTankSwept(to, amount);
    }

    /*//////////////////////////////////////////////////////////////////////////
                                   ERC-721 INTAKE
    //////////////////////////////////////////////////////////////////////////*/

    /**
     * @dev Sablier Lockup v4.0 mints the stream NFT with `_mint`, not
     *      `_safeMint`, so this hook is not strictly required today. It is
     *      implemented anyway so the adapter stays a valid NFT holder if that
     *      ever changes and so an existing stream can be `safeTransferFrom`'d in.
     */
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}
