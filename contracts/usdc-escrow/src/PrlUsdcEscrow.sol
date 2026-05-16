// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Like {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
}

contract PrlUsdcEscrow {
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
        address usdcToken;
        uint256 amount;
        uint256 fee;
        uint64 expiry;
        TradeStatus status;
    }

    address public owner;
    address public feeRecipient;
    bool public paused;

    mapping(bytes32 => Trade) public trades;

    event TradeCreated(bytes32 indexed tradeId, address indexed buyer, address indexed seller, uint256 amount, uint256 fee, uint64 expiry);
    event Deposited(bytes32 indexed tradeId, address indexed payer, uint256 amount);
    event Released(bytes32 indexed tradeId, address indexed seller, uint256 sellerAmount, uint256 feeAmount);
    event Refunded(bytes32 indexed tradeId, address indexed buyer, uint256 amount);
    event Cancelled(bytes32 indexed tradeId);
    event Paused(address indexed actor);
    event Unpaused(address indexed actor);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "paused");
        _;
    }

    constructor(address feeRecipient_) {
        require(feeRecipient_ != address(0), "fee recipient required");
        owner = msg.sender;
        feeRecipient = feeRecipient_;
    }

    function createTrade(
        bytes32 tradeId,
        address buyer,
        address seller,
        address usdcToken,
        uint256 amount,
        uint256 fee,
        uint64 expiry
    ) external onlyOwner whenNotPaused {
        require(tradeId != bytes32(0), "trade id required");
        require(trades[tradeId].status == TradeStatus.None, "trade exists");
        require(buyer != address(0) && seller != address(0), "party required");
        require(usdcToken != address(0), "token required");
        require(amount > 0, "amount required");
        require(expiry > block.timestamp, "expiry must be future");

        trades[tradeId] = Trade({
            buyer: buyer,
            seller: seller,
            usdcToken: usdcToken,
            amount: amount,
            fee: fee,
            expiry: expiry,
            status: TradeStatus.Created
        });

        emit TradeCreated(tradeId, buyer, seller, amount, fee, expiry);
    }

    function deposit(bytes32 tradeId) external whenNotPaused {
        Trade storage trade = trades[tradeId];
        require(trade.status == TradeStatus.Created, "not depositable");
        require(block.timestamp <= trade.expiry, "expired");
        require(msg.sender == trade.buyer, "not buyer");

        uint256 total = trade.amount + trade.fee;
        require(IERC20Like(trade.usdcToken).transferFrom(msg.sender, address(this), total), "transfer failed");
        trade.status = TradeStatus.Deposited;

        emit Deposited(tradeId, msg.sender, total);
    }

    function release(bytes32 tradeId) external onlyOwner whenNotPaused {
        Trade storage trade = trades[tradeId];
        require(trade.status == TradeStatus.Deposited, "not releasable");

        trade.status = TradeStatus.Released;
        require(IERC20Like(trade.usdcToken).transfer(trade.seller, trade.amount), "seller transfer failed");
        if (trade.fee > 0) {
            require(IERC20Like(trade.usdcToken).transfer(feeRecipient, trade.fee), "fee transfer failed");
        }

        emit Released(tradeId, trade.seller, trade.amount, trade.fee);
    }

    function refund(bytes32 tradeId) external whenNotPaused {
        Trade storage trade = trades[tradeId];
        require(trade.status == TradeStatus.Deposited, "not refundable");
        require(msg.sender == owner || block.timestamp > trade.expiry, "not authorized");

        uint256 total = trade.amount + trade.fee;
        trade.status = TradeStatus.Refunded;
        require(IERC20Like(trade.usdcToken).transfer(trade.buyer, total), "refund transfer failed");

        emit Refunded(tradeId, trade.buyer, total);
    }

    function cancelExpired(bytes32 tradeId) external whenNotPaused {
        Trade storage trade = trades[tradeId];
        require(trade.status == TradeStatus.Created, "not cancellable");
        require(block.timestamp > trade.expiry, "not expired");

        trade.status = TradeStatus.Cancelled;
        emit Cancelled(tradeId);
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }
}
