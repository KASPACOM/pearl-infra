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
    address private constant NEW_OWNER = address(0xA11CE);
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
        escrow.deposit(TRADE_ID, SELLER, AMOUNT, FEE);

        _assertEq(usdc.balanceOf(address(escrow)), AMOUNT + FEE);
        _assertStatus(_status(), PrlUsdcEscrow.TradeStatus.Deposited);
    }

    function testDepositAtExpiryIsAllowed() external {
        uint64 expiry = _futureExpiry();
        escrow.createTrade(TRADE_ID, BUYER, SELLER, AMOUNT, FEE, expiry);
        _fundAndApproveBuyer(AMOUNT + FEE);
        VM.warp(expiry);

        VM.prank(BUYER);
        escrow.deposit(TRADE_ID, SELLER, AMOUNT, FEE);

        _assertEq(usdc.balanceOf(address(escrow)), AMOUNT + FEE);
        _assertStatus(_status(), PrlUsdcEscrow.TradeStatus.Deposited);
    }

    function testDepositAfterExpiryIsBlocked() external {
        uint64 expiry = _futureExpiry();
        escrow.createTrade(TRADE_ID, BUYER, SELLER, AMOUNT, FEE, expiry);
        _fundAndApproveBuyer(AMOUNT + FEE);
        VM.warp(expiry + 1);

        VM.prank(BUYER);
        VM.expectRevert(bytes("expired"));
        escrow.deposit(TRADE_ID, SELLER, AMOUNT, FEE);

        _assertEq(usdc.balanceOf(address(escrow)), 0);
        _assertStatus(_status(), PrlUsdcEscrow.TradeStatus.Created);
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

    function testBuyerRefundRequiresTimestampAfterExpiry() external {
        uint64 expiry = _futureExpiry();
        escrow.createTrade(TRADE_ID, BUYER, SELLER, AMOUNT, FEE, expiry);
        _fundAndApproveBuyer(AMOUNT + FEE);

        VM.prank(BUYER);
        escrow.deposit(TRADE_ID, SELLER, AMOUNT, FEE);

        VM.warp(expiry);
        VM.prank(BUYER);
        VM.expectRevert(bytes("not authorized"));
        escrow.refund(TRADE_ID);

        VM.warp(expiry + 1);
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

    function testCancelCreatedTradeRequiresTimestampAfterExpiry() external {
        uint64 expiry = _futureExpiry();
        escrow.createTrade(TRADE_ID, BUYER, SELLER, AMOUNT, FEE, expiry);

        VM.warp(expiry);
        VM.prank(STRANGER);
        VM.expectRevert(bytes("not expired"));
        escrow.cancelExpired(TRADE_ID);

        VM.warp(expiry + 1);
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
        escrow.deposit(TRADE_ID, SELLER, AMOUNT, FEE);

        VM.expectRevert();
        escrow.release(TRADE_ID);
    }

    function testPauseAllowsExpiredBuyerRefundAndCreatedTradeCleanup() external {
        _depositTrade();
        escrow.pause();
        VM.warp(_futureExpiry() + 1);

        VM.prank(BUYER);
        escrow.refund(TRADE_ID);

        _assertEq(usdc.balanceOf(BUYER), AMOUNT + FEE);
        _assertStatus(_status(), PrlUsdcEscrow.TradeStatus.Refunded);

        bytes32 cleanupTradeId = keccak256("cleanup-trade");
        escrow.unpause();
        escrow.createTrade(cleanupTradeId, BUYER, SELLER, AMOUNT, FEE, _futureExpiry());
        escrow.pause();
        VM.warp(_futureExpiry() + 1);

        VM.prank(STRANGER);
        escrow.cancelExpired(cleanupTradeId);

        _assertStatus(_status(cleanupTradeId), PrlUsdcEscrow.TradeStatus.Cancelled);
    }

    function testRenounceOwnershipIsDisabled() external {
        VM.expectRevert(bytes("renounce disabled"));
        escrow.renounceOwnership();
        _assertEq(escrow.owner(), address(this));
    }

    function testOwnershipTransferUsesTwoStepHandoff() external {
        escrow.transferOwnership(NEW_OWNER);

        _assertEq(escrow.owner(), address(this));
        _assertEq(escrow.pendingOwner(), NEW_OWNER);

        VM.prank(NEW_OWNER);
        escrow.acceptOwnership();

        _assertEq(escrow.owner(), NEW_OWNER);
        _assertEq(escrow.pendingOwner(), address(0));
    }

    function testRejectsUnauthorizedCallers() external {
        VM.prank(STRANGER);
        VM.expectRevert();
        escrow.createTrade(TRADE_ID, BUYER, SELLER, AMOUNT, FEE, _futureExpiry());

        _createTrade();
        _fundAndApproveBuyer(AMOUNT + FEE);

        VM.prank(STRANGER);
        VM.expectRevert(bytes("not buyer"));
        escrow.deposit(TRADE_ID, SELLER, AMOUNT, FEE);

        VM.prank(BUYER);
        escrow.deposit(TRADE_ID, SELLER, AMOUNT, FEE);

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

    function testMultipleTradeIdsSettleIndependently() external {
        bytes32 releaseTradeId = keccak256("parallel-release");
        bytes32 refundTradeId = keccak256("parallel-refund");
        bytes32 cancelTradeId = keccak256("parallel-cancel");
        address releaseBuyer = address(0xB001);
        address refundBuyer = address(0xB002);
        address releaseSeller = address(0x5E1101);
        address refundSeller = address(0x5E1102);
        uint256 releaseAmount = 100e6;
        uint256 releaseFee = 1e6;
        uint256 refundAmount = 200e6;
        uint256 refundFee = 2e6;

        _createTrade(releaseTradeId, releaseBuyer, releaseSeller, releaseAmount, releaseFee);
        _createTrade(refundTradeId, refundBuyer, refundSeller, refundAmount, refundFee);
        _createTrade(cancelTradeId, address(0xB003), address(0x5E1103), 300e6, 3e6);
        _fundApproveAndDeposit(releaseTradeId, releaseBuyer, releaseAmount + releaseFee);
        _fundApproveAndDeposit(refundTradeId, refundBuyer, refundAmount + refundFee);

        escrow.release(releaseTradeId);
        VM.warp(_futureExpiry() + 1);
        VM.prank(refundBuyer);
        escrow.refund(refundTradeId);
        escrow.cancelExpired(cancelTradeId);

        _assertEq(usdc.balanceOf(releaseSeller), releaseAmount);
        _assertEq(usdc.balanceOf(FEE_RECIPIENT), releaseFee);
        _assertEq(usdc.balanceOf(refundBuyer), refundAmount + refundFee);
        _assertEq(usdc.balanceOf(refundSeller), 0);
        _assertEq(usdc.balanceOf(address(escrow)), 0);
        _assertStatus(_status(releaseTradeId), PrlUsdcEscrow.TradeStatus.Released);
        _assertStatus(_status(refundTradeId), PrlUsdcEscrow.TradeStatus.Refunded);
        _assertStatus(_status(cancelTradeId), PrlUsdcEscrow.TradeStatus.Cancelled);
    }

    function testTradeIdsCannotBeReusedAfterTerminalStates() external {
        bytes32 releasedTradeId = keccak256("released-key");
        bytes32 refundedTradeId = keccak256("refunded-key");
        bytes32 cancelledTradeId = keccak256("cancelled-key");

        _createTrade(releasedTradeId, BUYER, SELLER, AMOUNT, FEE);
        _fundApproveAndDeposit(releasedTradeId, BUYER, AMOUNT + FEE);
        escrow.release(releasedTradeId);

        _createTrade(refundedTradeId, address(0xB004), address(0x5E1104), AMOUNT, FEE);
        _fundApproveAndDeposit(refundedTradeId, address(0xB004), AMOUNT + FEE);
        escrow.refund(refundedTradeId);

        _createTrade(cancelledTradeId, address(0xB005), address(0x5E1105), AMOUNT, FEE);
        VM.warp(_futureExpiry() + 1);
        escrow.cancelExpired(cancelledTradeId);

        _expectTradeExists(releasedTradeId);
        _expectTradeExists(refundedTradeId);
        _expectTradeExists(cancelledTradeId);
    }

    function _createTrade() private {
        _createTrade(TRADE_ID, BUYER, SELLER, AMOUNT, FEE);
    }

    function _createTrade(bytes32 tradeId, address buyer, address seller, uint256 amount, uint256 fee) private {
        escrow.createTrade(tradeId, buyer, seller, amount, fee, _futureExpiry());
    }

    function _depositTrade() private {
        _createTrade();
        _fundApproveAndDeposit(TRADE_ID, BUYER, AMOUNT + FEE);
    }

    function _fundAndApproveBuyer(uint256 amount) private {
        usdc.mint(BUYER, amount);
        VM.prank(BUYER);
        usdc.approve(address(escrow), amount);
    }

    function _fundApproveAndDeposit(bytes32 tradeId, address buyer, uint256 amount) private {
        // Read the on-chain trade FIRST so the prank below is still active when
        // escrow.deposit is called. Foundry's VM.prank only persists for the next call.
        (, address seller, uint256 expectedAmount, uint256 expectedFee,,) = escrow.trades(tradeId);
        usdc.mint(buyer, amount);
        VM.prank(buyer);
        usdc.approve(address(escrow), amount);
        VM.prank(buyer);
        escrow.deposit(tradeId, seller, expectedAmount, expectedFee);
    }

    function _expectTradeExists(bytes32 tradeId) private {
        VM.expectRevert(bytes("trade exists"));
        escrow.createTrade(tradeId, BUYER, SELLER, AMOUNT, FEE, _futureExpiry());
    }

    function _futureExpiry() private view returns (uint64) {
        return uint64(block.timestamp + 1 days);
    }

    function _status() private view returns (PrlUsdcEscrow.TradeStatus status) {
        return _status(TRADE_ID);
    }

    function _status(bytes32 tradeId) private view returns (PrlUsdcEscrow.TradeStatus status) {
        (,,,,, status) = escrow.trades(tradeId);
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

    // ---------- Operator role ----------

    function testOperatorStartsUnset() external view {
        _assertEq(escrow.operator(), address(0));
    }

    function testSetOperatorOnlyOwner() external {
        VM.prank(STRANGER);
        VM.expectRevert();
        escrow.setOperator(NEW_OWNER);
    }

    function testOwnerCanSetAndRotateOperator() external {
        escrow.setOperator(NEW_OWNER);
        _assertEq(escrow.operator(), NEW_OWNER);
        escrow.setOperator(STRANGER);
        _assertEq(escrow.operator(), STRANGER);
    }

    function testOperatorCanCreateTradeAndRelease() external {
        escrow.setOperator(NEW_OWNER);

        VM.prank(NEW_OWNER);
        escrow.createTrade(TRADE_ID, BUYER, SELLER, AMOUNT, FEE, _futureExpiry());

        _fundApproveAndDeposit(TRADE_ID, BUYER, AMOUNT + FEE);

        VM.prank(NEW_OWNER);
        escrow.release(TRADE_ID);

        _assertStatus(_status(), PrlUsdcEscrow.TradeStatus.Released);
        _assertEq(usdc.balanceOf(SELLER), AMOUNT);
        _assertEq(usdc.balanceOf(FEE_RECIPIENT), FEE);
    }

    function testOperatorCannotRefundEarly() external {
        // Operator deliberately cannot refund (closes the post-Pearl-release grief
        // vector where a compromised operator could rug the seller). Only owner or
        // buyer-after-expiry may refund. See PrlUsdcEscrow.refund authorization
        // comment for rationale.
        escrow.setOperator(NEW_OWNER);
        _depositTrade();

        VM.prank(NEW_OWNER);
        VM.expectRevert(bytes("not authorized"));
        escrow.refund(TRADE_ID);
    }

    function testOwnerStillRetainsOperatorPowersWhenOperatorUnset() external {
        // Operator never set; owner must still be able to drive trades.
        escrow.createTrade(TRADE_ID, BUYER, SELLER, AMOUNT, FEE, _futureExpiry());
        _fundApproveAndDeposit(TRADE_ID, BUYER, AMOUNT + FEE);
        escrow.release(TRADE_ID);
        _assertStatus(_status(), PrlUsdcEscrow.TradeStatus.Released);
    }

    function testRotatingOperatorRevokesOldKey() external {
        escrow.setOperator(NEW_OWNER);
        escrow.setOperator(STRANGER);

        VM.prank(NEW_OWNER);
        VM.expectRevert(bytes("not operator"));
        escrow.createTrade(TRADE_ID, BUYER, SELLER, AMOUNT, FEE, _futureExpiry());

        // The newly-installed operator still works.
        VM.prank(STRANGER);
        escrow.createTrade(TRADE_ID, BUYER, SELLER, AMOUNT, FEE, _futureExpiry());
        _assertStatus(_status(), PrlUsdcEscrow.TradeStatus.Created);
    }

    function testNonOperatorNonOwnerCannotCreateOrRelease() external {
        escrow.setOperator(NEW_OWNER);

        VM.prank(STRANGER);
        VM.expectRevert(bytes("not operator"));
        escrow.createTrade(TRADE_ID, BUYER, SELLER, AMOUNT, FEE, _futureExpiry());

        _createTrade();
        _fundApproveAndDeposit(TRADE_ID, BUYER, AMOUNT + FEE);

        VM.prank(STRANGER);
        VM.expectRevert(bytes("not operator"));
        escrow.release(TRADE_ID);
    }

    function testOperatorCannotPause() external {
        escrow.setOperator(NEW_OWNER);
        VM.prank(NEW_OWNER);
        VM.expectRevert();
        escrow.pause();
    }

    function testOperatorCannotChangeFeeRecipient() external {
        escrow.setOperator(NEW_OWNER);
        VM.prank(NEW_OWNER);
        VM.expectRevert();
        escrow.setFeeRecipient(STRANGER);
    }

    function testOperatorCannotRotateOperator() external {
        escrow.setOperator(NEW_OWNER);
        VM.prank(NEW_OWNER);
        VM.expectRevert();
        escrow.setOperator(STRANGER);
    }

    // ---------- Deposit guard (anti-frontrun) ----------

    function testDepositRejectsSellerMismatch() external {
        _createTrade();
        _fundAndApproveBuyer(AMOUNT + FEE);

        VM.prank(BUYER);
        VM.expectRevert(bytes("seller mismatch"));
        escrow.deposit(TRADE_ID, STRANGER, AMOUNT, FEE);

        // Real seller still works.
        VM.prank(BUYER);
        escrow.deposit(TRADE_ID, SELLER, AMOUNT, FEE);
        _assertStatus(_status(), PrlUsdcEscrow.TradeStatus.Deposited);
    }

    function testDepositRejectsAmountOrFeeMismatch() external {
        _createTrade();
        _fundAndApproveBuyer(AMOUNT + FEE);

        VM.prank(BUYER);
        VM.expectRevert(bytes("amount mismatch"));
        escrow.deposit(TRADE_ID, SELLER, AMOUNT - 1, FEE);

        VM.prank(BUYER);
        VM.expectRevert(bytes("fee mismatch"));
        escrow.deposit(TRADE_ID, SELLER, AMOUNT, FEE + 1);
    }

    function testCompromisedOperatorCannotRedirectViaCreateTradeFrontrun() external {
        // Attack scenario: operator key is compromised. Attacker frontruns the OTC API
        // by createTrade'ing with the same tradeId but their own address as seller,
        // hoping the buyer's wallet will deposit anyway. The deposit guard forces the
        // buyer to commit to the expected seller on chain, so the attacker's trade is
        // rejected at deposit time.
        escrow.setOperator(NEW_OWNER);

        // Attacker creates the malicious trade with their address as seller.
        address attacker = STRANGER;
        VM.prank(NEW_OWNER);  // simulating compromised operator key
        escrow.createTrade(TRADE_ID, BUYER, attacker, AMOUNT, FEE, _futureExpiry());

        // Real OTC API cannot create the legitimate trade — same tradeId already taken.
        VM.expectRevert(bytes("trade exists"));
        escrow.createTrade(TRADE_ID, BUYER, SELLER, AMOUNT, FEE, _futureExpiry());

        // Buyer tries to deposit expecting the LEGITIMATE seller. Reverts.
        _fundAndApproveBuyer(AMOUNT + FEE);
        VM.prank(BUYER);
        VM.expectRevert(bytes("seller mismatch"));
        escrow.deposit(TRADE_ID, SELLER, AMOUNT, FEE);

        // No USDC moved.
        _assertEq(usdc.balanceOf(address(escrow)), 0);
        _assertEq(usdc.balanceOf(attacker), 0);
    }

    // ---------- setFeeRecipient ----------

    function testOwnerCanRotateFeeRecipient() external {
        escrow.setFeeRecipient(NEW_OWNER);
        _assertEq(escrow.feeRecipient(), NEW_OWNER);

        _depositTrade();
        escrow.release(TRADE_ID);
        _assertEq(usdc.balanceOf(NEW_OWNER), FEE);
    }

    function testSetFeeRecipientRejectsZero() external {
        VM.expectRevert(bytes("fee recipient required"));
        escrow.setFeeRecipient(address(0));
    }
}
