// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

contract PrlUsdcEscrow is Ownable2Step, Pausable {
    using SafeERC20 for IERC20;

    enum TradeStatus {
        None,
        Created,
        Deposited,
        Released,
        Refunded,
        Cancelled
    }

    struct Trade {
        address buyer;
        address seller;
        uint256 amount;
        uint256 fee;
        uint64 expiry;
        TradeStatus status;
    }

    address public feeRecipient;
    IERC20 private immutable USDC_TOKEN;

    mapping(bytes32 => Trade) public trades;

    event TradeCreated(
        bytes32 indexed tradeId,
        address indexed buyer,
        address indexed seller,
        uint256 amount,
        uint256 fee,
        uint64 expiry
    );
    event Deposited(bytes32 indexed tradeId, address indexed payer, uint256 amount);
    event Released(bytes32 indexed tradeId, address indexed seller, uint256 sellerAmount, uint256 feeAmount);
    event Refunded(bytes32 indexed tradeId, address indexed buyer, uint256 amount);
    event Cancelled(bytes32 indexed tradeId);

    constructor(address feeRecipient_, address usdcToken_) Ownable(msg.sender) {
        require(feeRecipient_ != address(0), "fee recipient required");
        require(usdcToken_ != address(0), "token required");
        feeRecipient = feeRecipient_;
        USDC_TOKEN = IERC20(usdcToken_);
    }

    function usdcToken() external view returns (address) {
        return address(USDC_TOKEN);
    }

    function createTrade(bytes32 tradeId, address buyer, address seller, uint256 amount, uint256 fee, uint64 expiry)
        external
        onlyOwner
        whenNotPaused
    {
        require(tradeId != bytes32(0), "trade id required");
        require(trades[tradeId].status == TradeStatus.None, "trade exists");
        require(buyer != address(0) && seller != address(0), "party required");
        require(amount > 0, "amount required");
        require(expiry > block.timestamp, "expiry must be future");

        trades[tradeId] = Trade({
            buyer: buyer, seller: seller, amount: amount, fee: fee, expiry: expiry, status: TradeStatus.Created
        });

        emit TradeCreated(tradeId, buyer, seller, amount, fee, expiry);
    }

    function deposit(bytes32 tradeId) external whenNotPaused {
        Trade storage trade = trades[tradeId];
        require(trade.status == TradeStatus.Created, "not depositable");
        require(block.timestamp <= trade.expiry, "expired");
        require(msg.sender == trade.buyer, "not buyer");

        uint256 total = trade.amount + trade.fee;
        USDC_TOKEN.safeTransferFrom(msg.sender, address(this), total);
        trade.status = TradeStatus.Deposited;

        emit Deposited(tradeId, msg.sender, total);
    }

    function release(bytes32 tradeId) external onlyOwner whenNotPaused {
        Trade storage trade = trades[tradeId];
        require(trade.status == TradeStatus.Deposited, "not releasable");

        trade.status = TradeStatus.Released;
        USDC_TOKEN.safeTransfer(trade.seller, trade.amount);
        if (trade.fee > 0) {
            USDC_TOKEN.safeTransfer(feeRecipient, trade.fee);
        }

        emit Released(tradeId, trade.seller, trade.amount, trade.fee);
    }

    function refund(bytes32 tradeId) external {
        Trade storage trade = trades[tradeId];
        require(trade.status == TradeStatus.Deposited, "not refundable");
        require(
            msg.sender == owner() || (msg.sender == trade.buyer && block.timestamp > trade.expiry), "not authorized"
        );

        uint256 total = trade.amount + trade.fee;
        trade.status = TradeStatus.Refunded;
        USDC_TOKEN.safeTransfer(trade.buyer, total);

        emit Refunded(tradeId, trade.buyer, total);
    }

    function cancelExpired(bytes32 tradeId) external {
        Trade storage trade = trades[tradeId];
        require(trade.status == TradeStatus.Created, "not cancellable");
        require(block.timestamp > trade.expiry, "not expired");

        trade.status = TradeStatus.Cancelled;
        emit Cancelled(tradeId);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function renounceOwnership() public view override onlyOwner {
        revert("renounce disabled");
    }
}
