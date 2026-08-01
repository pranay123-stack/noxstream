// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Lockup} from "@sablier/lockup/src/types/Lockup.sol";
import {LockupLinear} from "@sablier/lockup/src/types/LockupLinear.sol";

/**
 * @title MockSablierLockup
 * @notice A **local-test-only** stand-in for Sablier's deployed `SablierLockup`.
 *
 * ## Why this exists
 *
 * `SablierStreamAdapter` composes with the real, deployed Sablier Lockup v4.0 —
 * that is the entire point of the adapter and it is what the Sepolia deployment
 * and the Sepolia e2e test use (`0xe61cb9153356419bdaD0A8767c059f92d221a3C4`,
 * see docs/STREAM_PROTOCOL.md). But the unit tests run on an ephemeral
 * `edr-simulated` chain where no third-party protocol exists.
 *
 * The alternative would have been to write a second, simpler `IStreamAdapter`
 * for local tests. That would leave `SablierStreamAdapter` — including its fee
 * tank, its destination guard and its `uint128` bounds check — completely
 * untested until it hit real money on a testnet. Standing up a minimal Lockup
 * instead means the unit tests exercise the *real* adapter bytecode.
 *
 * ## What it is and is not
 *
 * It reproduces only the four entry points the adapter calls, with Sablier's
 * exact selectors and struct types (imported from the official Sablier npm
 * package, not hand-copied):
 *   `createWithDurationsLL`, `withdrawableAmountOf`, `calculateMinFeeWei`,
 *   `withdraw`.
 *
 * It deliberately does NOT implement `ISablierLockup` in full — no NFT, no
 * cancellation, no cliffs, no comptroller, no hooks. It is a test double, it is
 * never deployed by `scripts/deploy.ts` on a live network (the deploy script
 * refuses to substitute it off chain 31337), and nothing on the demo path
 * touches it.
 *
 * NOT FOR PRODUCTION.
 */
contract MockSablierLockup {
    using SafeERC20 for IERC20;

    struct Stream {
        address sender;
        address recipient;
        IERC20 token;
        uint128 deposited;
        uint128 withdrawn;
        uint40 startTime;
        uint40 endTime;
    }

    /// @dev Sablier stream ids start at 1; 0 is the adapter's "no stream" sentinel.
    uint256 public nextStreamId = 1;

    /**
     * @dev The native-token withdrawal fee Sablier v3.0+ charges. Defaults to
     *      the value observed on Sepolia (483,091,068,406,659 wei) so the local
     *      tests exercise the adapter's fee-tank path for real rather than
     *      trivially passing with a zero fee.
     */
    uint256 public minFeeWei = 483_091_068_406_659;

    mapping(uint256 streamId => Stream) private _streams;

    error StreamNotFound(uint256 streamId);
    error FeeTooLow(uint256 required, uint256 sent);
    error Overdraw(uint128 requested, uint128 available);
    error NotRecipient(address caller);

    /// @notice Test hook: change the simulated protocol fee.
    function setMinFeeWei(uint256 newFee) external {
        minFeeWei = newFee;
    }

    function createWithDurationsLL(
        Lockup.CreateWithDurations calldata params,
        LockupLinear.UnlockAmounts calldata,
        uint40,
        LockupLinear.Durations calldata durations
    ) external payable returns (uint256 streamId) {
        streamId = nextStreamId++;

        params.token.safeTransferFrom(msg.sender, address(this), params.depositAmount);

        _streams[streamId] = Stream({
            sender: params.sender,
            recipient: params.recipient,
            token: params.token,
            deposited: params.depositAmount,
            withdrawn: 0,
            startTime: uint40(block.timestamp),
            endTime: uint40(block.timestamp) + durations.total
        });
    }

    /// @notice Linear, per-second unlock — the classic Sablier LL curve.
    function withdrawableAmountOf(uint256 streamId) public view returns (uint128) {
        Stream storage s = _streams[streamId];
        if (s.deposited == 0) revert StreamNotFound(streamId);

        uint256 unlocked;
        if (block.timestamp >= s.endTime) {
            unlocked = s.deposited;
        } else if (block.timestamp <= s.startTime) {
            unlocked = 0;
        } else {
            unlocked =
                (uint256(s.deposited) * (block.timestamp - s.startTime)) /
                (uint256(s.endTime) - s.startTime);
        }
        return uint128(unlocked - s.withdrawn);
    }

    function calculateMinFeeWei(uint256 streamId) external view returns (uint256) {
        if (_streams[streamId].deposited == 0) revert StreamNotFound(streamId);
        return minFeeWei;
    }

    function withdraw(uint256 streamId, address to, uint128 amount) external payable {
        Stream storage s = _streams[streamId];
        if (s.deposited == 0) revert StreamNotFound(streamId);
        if (msg.value < minFeeWei) revert FeeTooLow(minFeeWei, msg.value);
        // Sablier only lets a non-owner withdraw to the stream's recipient. The
        // adapter is both owner and recipient, so this mirrors the real check.
        if (to != s.recipient && msg.sender != s.recipient) revert NotRecipient(msg.sender);

        uint128 available = withdrawableAmountOf(streamId);
        if (amount > available) revert Overdraw(amount, available);

        s.withdrawn += amount;
        s.token.safeTransfer(to, amount);
    }

    /// @notice Mirrors Sablier's own getter closely enough for assertions.
    function getStream(uint256 streamId) external view returns (Stream memory) {
        return _streams[streamId];
    }
}
