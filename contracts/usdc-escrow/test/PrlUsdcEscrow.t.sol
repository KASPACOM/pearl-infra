// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {PrlUsdcEscrow} from "../src/PrlUsdcEscrow.sol";

interface Vm {
    function expectRevert() external;
    function expectRevert(bytes calldata revertData) external;
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
}

contract MockUsdc is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract PrlUsdcEscrowTest {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    bytes32 private constant TRADE_ID = keccak256("trade-1");
    address private constant BUYER = address(0xB0B);
    address private constant SELLER = address(0x5E11E2);
    address private constant FEE_RECIPIENT = address(0xFEE);
    address private constant STRANGER = address(0xBAD);
    uint256 private constant AMOUNT = 100e6;
    uint256 private constant FEE = 2e6;

    MockUsdc private usdc;
    PrlUsdcEscrow private escrow;

    function setUp() external {
        usdc = new MockUsdc();
        escrow = new PrlUsdcEscrow(FEE_RECIPIENT, address(usdc));
        VM.warp(1_700_000_000);
    }

    function testCreateTradeStoresTerms() external {
        uint64 expiry = _futureExpiry();

        escrow.createTrade(TRADE_ID, BUYER, SELLER, AMOUNT, FEE, expiry);

        (
            address buyer,
            address seller,
            uint256 amount,
            uint256 fee,
            uint64 storedExpiry,
            PrlUsdcEscrow.TradeStatus status
        ) = escrow.trades(TRADE_ID);

        _assertEq(buyer, BUYER);
        _assertEq(seller, SELLER);
        _assertEq(amount, AMOUNT);
        _assertEq(fee, FEE);
        _assertEq(uint256(storedExpiry), uint256(expiry));
        _assertStatus(status, PrlUsdcEscrow.TradeStatus.Created);
    }

    function testDepositTransfersUsdcFromBuyer() external {
        _createTrade();
        _fundAndApproveBuyer(AMOUNT + FEE);

        VM.prank(BUYER);
        escrow.deposit(TRADE_ID);

        _assertEq(usdc.balanceOf(address(escrow)), AMOUNT + FEE);
        _assertStatus(_status(), PrlUsdcEscrow.TradeStatus.Deposited);
    }

    function testReleasePaysSellerAndFeeRecipient() external {
        _depositTrade();

        escrow.release(TRADE_ID);

        _assertEq(usdc.balanceOf(SELLER), AMOUNT);
        _assertEq(usdc.balanceOf(FEE_RECIPIENT), FEE);
        _assertStatus(_status(), PrlUsdcEscrow.TradeStatus.Released);
    }

    function testRefundAfterExpiryReturnsAmountAndFeeToBuyer() external {
        _depositTrade();
        VM.warp(_futureExpiry() + 1);

        VM.prank(BUYER);
        escrow.refund(TRADE_ID);

        _assertEq(usdc.balanceOf(BUYER), AMOUNT + FEE);
        _assertEq(usdc.balanceOf(address(escrow)), 0);
        _assertStatus(_status(), PrlUsdcEscrow.TradeStatus.Refunded);
    }

    function testOwnerCanRefundBeforeExpiry() external {
        _depositTrade();

        escrow.refund(TRADE_ID);

        _assertEq(usdc.balanceOf(BUYER), AMOUNT + FEE);
        _assertStatus(_status(), PrlUsdcEscrow.TradeStatus.Refunded);
    }

    function testCancelExpiredTrade() external {
        _createTrade();
        VM.warp(_futureExpiry() + 1);

        VM.prank(STRANGER);
        escrow.cancelExpired(TRADE_ID);

        _assertStatus(_status(), PrlUsdcEscrow.TradeStatus.Cancelled);
    }

    function testPauseBlocksStateChangingTradeFlows() external {
        escrow.pause();

        VM.expectRevert();
        escrow.createTrade(TRADE_ID, BUYER, SELLER, AMOUNT, FEE, _futureExpiry());

        escrow.unpause();
        _createTrade();
        _fundAndApproveBuyer(AMOUNT + FEE);
        escrow.pause();

        VM.prank(BUYER);
        VM.expectRevert();
        escrow.deposit(TRADE_ID);
    }

    function testRejectsUnauthorizedCallers() external {
        VM.prank(STRANGER);
        VM.expectRevert();
        escrow.createTrade(TRADE_ID, BUYER, SELLER, AMOUNT, FEE, _futureExpiry());

        _createTrade();
        _fundAndApproveBuyer(AMOUNT + FEE);

        VM.prank(STRANGER);
        VM.expectRevert(bytes("not buyer"));
        escrow.deposit(TRADE_ID);

        VM.prank(BUYER);
        escrow.deposit(TRADE_ID);

        VM.prank(STRANGER);
        VM.expectRevert();
        escrow.release(TRADE_ID);

        VM.prank(STRANGER);
        VM.expectRevert(bytes("not authorized"));
        escrow.refund(TRADE_ID);

        VM.prank(STRANGER);
        VM.expectRevert();
        escrow.pause();
    }

    function _createTrade() private {
        escrow.createTrade(TRADE_ID, BUYER, SELLER, AMOUNT, FEE, _futureExpiry());
    }

    function _depositTrade() private {
        _createTrade();
        _fundAndApproveBuyer(AMOUNT + FEE);

        VM.prank(BUYER);
        escrow.deposit(TRADE_ID);
    }

    function _fundAndApproveBuyer(uint256 amount) private {
        usdc.mint(BUYER, amount);
        VM.prank(BUYER);
        usdc.approve(address(escrow), amount);
    }

    function _futureExpiry() private view returns (uint64) {
        return uint64(block.timestamp + 1 days);
    }

    function _status() private view returns (PrlUsdcEscrow.TradeStatus status) {
        (,,,,, status) = escrow.trades(TRADE_ID);
    }

    function _assertStatus(PrlUsdcEscrow.TradeStatus actual, PrlUsdcEscrow.TradeStatus expected) private pure {
        require(actual == expected, "status mismatch");
    }

    function _assertEq(address actual, address expected) private pure {
        require(actual == expected, "address mismatch");
    }

    function _assertEq(uint256 actual, uint256 expected) private pure {
        require(actual == expected, "uint mismatch");
    }
}
