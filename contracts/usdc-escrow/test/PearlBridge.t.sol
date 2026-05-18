// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PearlBridge} from "../src/PearlBridge.sol";
import {WrappedPearl} from "../src/WrappedPearl.sol";

interface BridgeVm {
    function expectRevert() external;
    function expectRevert(bytes calldata revertData) external;
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
}

contract PearlBridgeTest {
    BridgeVm private constant VM = BridgeVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant RELAYER = address(0xA11CE);
    address private constant OPERATOR = address(0x0B0B);
    address private constant RECIPIENT = address(0xCAFE);
    address private constant REQUESTER = address(0xBEEF);
    address private constant STRANGER = address(0xBAD);

    uint256 private constant ONE_PRL = 100_000_000;
    uint256 private constant MIN_AMOUNT = 1 * ONE_PRL;
    uint256 private constant MAX_DEPOSIT = 100 * ONE_PRL;
    uint256 private constant MAX_EXIT = 50 * ONE_PRL;
    uint256 private constant ROLLING_CAP = 120 * ONE_PRL;
    uint256 private constant PILOT_CAP = 1_000 * ONE_PRL;

    WrappedPearl private token;
    PearlBridge private bridge;

    function setUp() external {
        VM.warp(1_800_000_000);
        token = new WrappedPearl(address(this));
        bridge = new PearlBridge(address(token), _defaultCaps(), address(this));
        token.setBridge(address(bridge));
        bridge.setRelayer(RELAYER, true);
        bridge.setOperator(OPERATOR, true);
    }

    function testWrappedPearlMetadataAndBridgeOnlyMint() external {
        _assertEq(token.name(), "Wrapped Pearl");
        _assertEq(token.symbol(), "wPRL");
        _assertEq(uint256(token.decimals()), 8);
        _assertEq(token.bridge(), address(bridge));

        VM.expectRevert(bytes("bridge contract required"));
        token.setBridge(STRANGER);

        VM.expectRevert(bytes("not bridge"));
        token.mint(RECIPIENT, ONE_PRL);

        _claim(_txid("deposit-1"), 0, RECIPIENT, 10 * ONE_PRL);
        _assertEq(token.balanceOf(RECIPIENT), 10 * ONE_PRL);
        _assertEq(token.totalSupply(), 10 * ONE_PRL);
    }

    function testDepositClaimMintsExactAmountAndStoresReplayKey() external {
        bytes32 pearlTxid = _txid("deposit-1");
        uint32 vout = 2;
        bytes32 claimId = bridge.depositClaimId(pearlTxid, vout);

        VM.prank(RELAYER);
        bytes32 returnedClaimId = bridge.claimDeposit(pearlTxid, vout, RECIPIENT, 7 * ONE_PRL);

        _assertEq(returnedClaimId, claimId);
        _assertTrue(bridge.claimedDeposits(claimId));
        _assertEq(token.balanceOf(RECIPIENT), 7 * ONE_PRL);
    }

    function testDepositClaimRejectsReplayEvenWithDifferentRecipient() external {
        bytes32 pearlTxid = _txid("deposit-1");
        _claim(pearlTxid, 0, RECIPIENT, 10 * ONE_PRL);

        VM.prank(RELAYER);
        VM.expectRevert(bytes("deposit claimed"));
        bridge.claimDeposit(pearlTxid, 0, address(0x1234), 10 * ONE_PRL);
    }

    function testDepositClaimRejectsUnauthorizedAndInvalidAmounts() external {
        VM.prank(STRANGER);
        VM.expectRevert(bytes("not relayer"));
        bridge.claimDeposit(_txid("deposit-1"), 0, RECIPIENT, 10 * ONE_PRL);

        VM.prank(RELAYER);
        VM.expectRevert(bytes("deposit below minimum"));
        bridge.claimDeposit(_txid("deposit-2"), 0, RECIPIENT, MIN_AMOUNT - 1);

        VM.prank(RELAYER);
        VM.expectRevert(bytes("deposit above maximum"));
        bridge.claimDeposit(_txid("deposit-3"), 0, RECIPIENT, MAX_DEPOSIT + 1);
    }

    function testDepositClaimEnforcesPilotSupplyCap() external {
        PearlBridge.Caps memory limited = _defaultCaps();
        limited.pilotSupplyCapGrains = 15 * ONE_PRL;
        limited.maxDepositGrains = 15 * ONE_PRL;
        limited.maxExitGrains = 15 * ONE_PRL;
        limited.rollingWindowMintCapGrains = 15 * ONE_PRL;
        bridge.setCaps(limited);

        _claim(_txid("deposit-1"), 0, RECIPIENT, 10 * ONE_PRL);

        VM.prank(RELAYER);
        VM.expectRevert(bytes("pilot cap exceeded"));
        bridge.claimDeposit(_txid("deposit-2"), 0, RECIPIENT, 6 * ONE_PRL);
    }

    function testDepositClaimEnforcesAndResetsRollingMintCap() external {
        _claim(_txid("deposit-1"), 0, RECIPIENT, 70 * ONE_PRL);

        VM.prank(RELAYER);
        VM.expectRevert(bytes("rolling cap exceeded"));
        bridge.claimDeposit(_txid("deposit-2"), 0, RECIPIENT, 60 * ONE_PRL);

        VM.warp(block.timestamp + 1 days + 1);
        _claim(_txid("deposit-2"), 0, RECIPIENT, 60 * ONE_PRL);

        _assertEq(token.balanceOf(RECIPIENT), 130 * ONE_PRL);
    }

    function testEntryPauseBlocksMintOnly() external {
        _claim(_txid("deposit-before-pause"), 0, REQUESTER, 10 * ONE_PRL);

        VM.prank(REQUESTER);
        bytes32 exitId = bridge.requestExit("prl1p-recipient", 2 * ONE_PRL);

        bridge.setEntryPaused(true);

        VM.prank(RELAYER);
        VM.expectRevert(bytes("entry paused"));
        bridge.claimDeposit(_txid("deposit-1"), 0, RECIPIENT, 10 * ONE_PRL);

        VM.prank(OPERATOR);
        bridge.refundExit(exitId);

        bridge.setEntryPaused(false);
        _claim(_txid("deposit-1"), 0, RECIPIENT, 10 * ONE_PRL);

        _assertEq(token.balanceOf(REQUESTER), 10 * ONE_PRL);
        _assertEq(token.balanceOf(RECIPIENT), 10 * ONE_PRL);
    }

    function testRequestExitBurnsAndRecordsExit() external {
        _claim(_txid("deposit-1"), 0, REQUESTER, 10 * ONE_PRL);

        VM.prank(REQUESTER);
        bytes32 exitId = bridge.requestExit("prl1p-recipient", 4 * ONE_PRL);

        (address requester, uint256 amount, string memory pearlRecipient, PearlBridge.ExitStatus status, bytes32 releaseTxid) =
            bridge.exits(exitId);

        _assertEq(requester, REQUESTER);
        _assertEq(amount, 4 * ONE_PRL);
        _assertEq(pearlRecipient, "prl1p-recipient");
        _assertStatus(status, PearlBridge.ExitStatus.Requested);
        _assertEq(releaseTxid, bytes32(0));
        _assertEq(token.balanceOf(REQUESTER), 6 * ONE_PRL);
        _assertEq(token.totalSupply(), 6 * ONE_PRL);
        _assertEq(bridge.pendingExitGrains(), 4 * ONE_PRL);
    }

    function testRequestExitRejectsDustZeroAndAboveMaximum() external {
        _claim(_txid("deposit-1"), 0, REQUESTER, 100 * ONE_PRL);

        VM.prank(REQUESTER);
        VM.expectRevert(bytes("exit below minimum"));
        bridge.requestExit("prl1p-recipient", 0);

        VM.prank(REQUESTER);
        VM.expectRevert(bytes("exit below minimum"));
        bridge.requestExit("prl1p-recipient", MIN_AMOUNT - 1);

        VM.prank(REQUESTER);
        VM.expectRevert(bytes("exit above maximum"));
        bridge.requestExit("prl1p-recipient", MAX_EXIT + 1);

        VM.prank(REQUESTER);
        VM.expectRevert(bytes("recipient required"));
        bridge.requestExit("", MIN_AMOUNT);
    }

    function testExitRequestPauseDoesNotBlockProcessingExistingExit() external {
        bytes32 exitId = _requestExit();
        bridge.setExitRequestPaused(true);

        VM.prank(REQUESTER);
        VM.expectRevert(bytes("exit request paused"));
        bridge.requestExit("prl1p-second", MIN_AMOUNT);

        VM.prank(OPERATOR);
        bridge.processExit(exitId, _txid("release-1"));

        _assertStatus(_exitStatus(exitId), PearlBridge.ExitStatus.Processed);
        _assertEq(bridge.pendingExitGrains(), 0);
    }

    function testExitProcessingIsIdempotentAndRejectsConflictingTxid() external {
        bytes32 exitId = _requestExit();
        bytes32 releaseTxid = _txid("release-1");

        VM.prank(OPERATOR);
        bridge.processExit(exitId, releaseTxid);
        _assertEq(bridge.releaseTxidToExitId(releaseTxid), exitId);

        VM.prank(OPERATOR);
        bridge.processExit(exitId, releaseTxid);

        VM.prank(OPERATOR);
        VM.expectRevert(bytes("conflicting release txid"));
        bridge.processExit(exitId, _txid("release-2"));
    }

    function testExitProcessingRejectsReleaseTxidReuseAcrossExits() external {
        bytes32 firstExitId = _requestExitWithNewRequester(REQUESTER, 1);
        bytes32 secondExitId = _requestExitWithNewRequester(address(0xC0FFEE), 2);
        bytes32 releaseTxid = _txid("release-1");

        VM.prank(OPERATOR);
        bridge.processExit(firstExitId, releaseTxid);

        VM.prank(OPERATOR);
        VM.expectRevert(bytes("release txid reused"));
        bridge.processExit(secondExitId, releaseTxid);
    }

    function testExitProcessingRequiresOperatorAndCanBePausedSeparately() external {
        bytes32 exitId = _requestExit();

        VM.prank(STRANGER);
        VM.expectRevert(bytes("not operator"));
        bridge.processExit(exitId, _txid("release-1"));

        bridge.setExitProcessingPaused(true);
        VM.prank(OPERATOR);
        VM.expectRevert(bytes("exit processing paused"));
        bridge.processExit(exitId, _txid("release-1"));
    }

    function testRefundExitMintsBackBurnedAmountAndBlocksProcessing() external {
        bytes32 exitId = _requestExit();

        VM.prank(OPERATOR);
        bridge.refundExit(exitId);

        _assertEq(token.balanceOf(REQUESTER), 10 * ONE_PRL);
        _assertEq(token.totalSupply(), 10 * ONE_PRL);
        _assertEq(bridge.pendingExitGrains(), 0);
        _assertStatus(_exitStatus(exitId), PearlBridge.ExitStatus.Refunded);

        VM.prank(OPERATOR);
        VM.expectRevert(bytes("exit not processable"));
        bridge.processExit(exitId, _txid("release-1"));

        VM.prank(OPERATOR);
        VM.expectRevert(bytes("exit not refundable"));
        bridge.refundExit(exitId);
    }

    function testPendingExitReserveKeepsPilotCapAuditable() external {
        PearlBridge.Caps memory limited = _defaultCaps();
        limited.pilotSupplyCapGrains = 20 * ONE_PRL;
        limited.maxDepositGrains = 20 * ONE_PRL;
        limited.maxExitGrains = 20 * ONE_PRL;
        limited.rollingWindowMintCapGrains = 20 * ONE_PRL;
        bridge.setCaps(limited);

        _claim(_txid("deposit-1"), 0, REQUESTER, 20 * ONE_PRL);

        VM.prank(REQUESTER);
        bytes32 exitId = bridge.requestExit("prl1p-recipient", 10 * ONE_PRL);

        VM.prank(RELAYER);
        VM.expectRevert(bytes("pilot cap exceeded"));
        bridge.claimDeposit(_txid("deposit-2"), 0, RECIPIENT, 11 * ONE_PRL);

        VM.prank(OPERATOR);
        bridge.refundExit(exitId);

        _assertEq(token.totalSupply(), 20 * ONE_PRL);
        _assertEq(bridge.pendingExitGrains(), 0);
    }

    function testSetCapsCannotLowerPilotCapBelowActiveSupply() external {
        _claim(_txid("deposit-1"), 0, RECIPIENT, 10 * ONE_PRL);

        PearlBridge.Caps memory lowered = _defaultCaps();
        lowered.pilotSupplyCapGrains = 9 * ONE_PRL;
        lowered.maxDepositGrains = 9 * ONE_PRL;
        lowered.maxExitGrains = 9 * ONE_PRL;
        lowered.rollingWindowMintCapGrains = 9 * ONE_PRL;

        VM.expectRevert(bytes("pilot cap below liabilities"));
        bridge.setCaps(lowered);
    }

    function testSetCapsCannotLowerPilotCapBelowActiveSupplyPlusPendingExits() external {
        _claim(_txid("deposit-1"), 0, REQUESTER, 20 * ONE_PRL);

        VM.prank(REQUESTER);
        bridge.requestExit("prl1p-recipient", 10 * ONE_PRL);

        PearlBridge.Caps memory lowered = _defaultCaps();
        lowered.pilotSupplyCapGrains = 15 * ONE_PRL;
        lowered.maxDepositGrains = 15 * ONE_PRL;
        lowered.maxExitGrains = 15 * ONE_PRL;
        lowered.rollingWindowMintCapGrains = 15 * ONE_PRL;

        VM.expectRevert(bytes("pilot cap below liabilities"));
        bridge.setCaps(lowered);
    }

    function testCapsValidationAndPermissionUpdates() external {
        PearlBridge.Caps memory invalid = _defaultCaps();
        invalid.maxDepositGrains = invalid.minDepositGrains - 1;
        VM.expectRevert(bytes("invalid deposit caps"));
        bridge.setCaps(invalid);

        VM.prank(STRANGER);
        VM.expectRevert();
        bridge.setCaps(_defaultCaps());

        VM.prank(STRANGER);
        VM.expectRevert();
        bridge.setRelayer(address(0xCA11), true);

        VM.prank(STRANGER);
        VM.expectRevert();
        bridge.setOperator(address(0x0C0C), true);

        VM.prank(STRANGER);
        VM.expectRevert();
        bridge.setEntryPaused(true);

        bridge.setRelayer(RELAYER, false);
        VM.prank(RELAYER);
        VM.expectRevert(bytes("not relayer"));
        bridge.claimDeposit(_txid("deposit-1"), 0, RECIPIENT, 10 * ONE_PRL);

        bridge.setOperator(OPERATOR, false);
        bridge.setRelayer(RELAYER, true);
        bytes32 exitId = _requestExitWithNewRequester(address(0xB0B0), 9);
        VM.prank(OPERATOR);
        VM.expectRevert(bytes("not operator"));
        bridge.processExit(exitId, _txid("release-1"));
    }

    function testOwnershipTransferUsesTwoStepAndRenounceIsDisabled() external {
        address newOwner = address(0xA11CE0);

        bridge.transferOwnership(newOwner);
        _assertEq(bridge.owner(), address(this));
        _assertEq(bridge.pendingOwner(), newOwner);

        VM.prank(newOwner);
        bridge.acceptOwnership();
        _assertEq(bridge.owner(), newOwner);

        VM.prank(newOwner);
        VM.expectRevert(bytes("renounce disabled"));
        bridge.renounceOwnership();

        token.transferOwnership(newOwner);
        VM.prank(newOwner);
        token.acceptOwnership();

        VM.prank(newOwner);
        VM.expectRevert(bytes("renounce disabled"));
        token.renounceOwnership();
    }

    function _claim(bytes32 pearlTxid, uint32 vout, address recipient, uint256 amountGrains) private {
        VM.prank(RELAYER);
        bridge.claimDeposit(pearlTxid, vout, recipient, amountGrains);
    }

    function _requestExit() private returns (bytes32) {
        return _requestExitWithNewRequester(REQUESTER, 1);
    }

    function _requestExitWithNewRequester(address requester, uint32 vout) private returns (bytes32 exitId) {
        _claim(_txid("deposit-for-exit"), vout, requester, 10 * ONE_PRL);

        VM.prank(requester);
        exitId = bridge.requestExit("prl1p-recipient", 4 * ONE_PRL);
    }

    function _defaultCaps() private pure returns (PearlBridge.Caps memory) {
        return PearlBridge.Caps({
            minDepositGrains: MIN_AMOUNT,
            maxDepositGrains: MAX_DEPOSIT,
            minExitGrains: MIN_AMOUNT,
            maxExitGrains: MAX_EXIT,
            rollingWindowSeconds: 1 days,
            rollingWindowMintCapGrains: ROLLING_CAP,
            pilotSupplyCapGrains: PILOT_CAP
        });
    }

    function _exitStatus(bytes32 exitId) private view returns (PearlBridge.ExitStatus status) {
        (,,, status,) = bridge.exits(exitId);
    }

    function _txid(string memory label) private pure returns (bytes32) {
        return keccak256(bytes(label));
    }

    function _assertStatus(PearlBridge.ExitStatus actual, PearlBridge.ExitStatus expected) private pure {
        require(actual == expected, "exit status mismatch");
    }

    function _assertTrue(bool actual) private pure {
        require(actual, "bool mismatch");
    }

    function _assertEq(address actual, address expected) private pure {
        require(actual == expected, "address mismatch");
    }

    function _assertEq(uint256 actual, uint256 expected) private pure {
        require(actual == expected, "uint mismatch");
    }

    function _assertEq(bytes32 actual, bytes32 expected) private pure {
        require(actual == expected, "bytes32 mismatch");
    }

    function _assertEq(string memory actual, string memory expected) private pure {
        require(keccak256(bytes(actual)) == keccak256(bytes(expected)), "string mismatch");
    }
}
