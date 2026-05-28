// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {WrappedPearl} from "./WrappedPearl.sol";

contract PearlBridge is Ownable2Step {
    enum ExitStatus {
        None,
        Requested,
        Processed,
        Refunded
    }

    struct Caps {
        uint256 minDepositGrains;
        uint256 maxDepositGrains;
        uint256 minExitGrains;
        uint256 maxExitGrains;
        uint256 rollingWindowSeconds;
        uint256 rollingWindowMintCapGrains;
        uint256 pilotSupplyCapGrains;
    }

    struct ExitRequest {
        address requester;
        uint256 amountGrains;
        string pearlRecipient;
        ExitStatus status;
        bytes32 pearlReleaseTxid;
    }

    WrappedPearl public immutable wrappedPearl;
    Caps public caps;

    bool public entryPaused;
    bool public exitRequestPaused;
    bool public exitProcessingPaused;

    uint256 public currentWindowStart;
    uint256 public currentWindowMintedGrains;
    uint256 public nextExitNonce;
    uint256 public pendingExitGrains;

    mapping(address => bool) public relayers;
    mapping(address => bool) public operators;
    mapping(bytes32 => bool) public claimedDeposits;
    mapping(bytes32 => ExitRequest) public exits;
    mapping(bytes32 => bytes32) public releaseTxidToExitId;

    event DepositClaimed(
        bytes32 indexed claimId,
        bytes32 indexed pearlTxid,
        uint32 indexed vout,
        address recipient,
        uint256 amountGrains
    );
    event ExitRequested(bytes32 indexed exitId, address indexed requester, string pearlRecipient, uint256 amountGrains);
    event ExitProcessed(bytes32 indexed exitId, bytes32 indexed pearlReleaseTxid, address indexed operator);
    event ExitRefunded(bytes32 indexed exitId, address indexed requester, uint256 amountGrains, address indexed operator);
    event CapsUpdated(Caps caps);
    event RelayerUpdated(address indexed relayer, bool enabled);
    event OperatorUpdated(address indexed operator, bool enabled);
    event EntryPaused(address indexed actor, bool paused);
    event ExitRequestPaused(address indexed actor, bool paused);
    event ExitProcessingPaused(address indexed actor, bool paused);

    modifier onlyRelayer() {
        _requireRelayer();
        _;
    }

    modifier onlyOperator() {
        _requireOperator();
        _;
    }

    constructor(address wrappedPearl_, Caps memory initialCaps, address initialOwner) Ownable(initialOwner) {
        require(wrappedPearl_ != address(0), "token required");
        require(wrappedPearl_.code.length > 0, "token contract required");
        require(initialOwner != address(0), "owner required");
        wrappedPearl = WrappedPearl(wrappedPearl_);
        _validateCaps(initialCaps);
        caps = initialCaps;
        currentWindowStart = block.timestamp;
        emit CapsUpdated(initialCaps);
    }

    function claimDeposit(bytes32 pearlTxid, uint32 vout, address recipient, uint256 amountGrains)
        external
        onlyRelayer
        returns (bytes32 claimId)
    {
        require(!entryPaused, "entry paused");
        require(pearlTxid != bytes32(0), "txid required");
        require(recipient != address(0), "recipient required");
        _requireDepositAmount(amountGrains);

        claimId = depositClaimId(pearlTxid, vout);
        require(!claimedDeposits[claimId], "deposit claimed");
        _consumeMintCapacity(amountGrains);

        claimedDeposits[claimId] = true;
        wrappedPearl.mint(recipient, amountGrains);

        emit DepositClaimed(claimId, pearlTxid, vout, recipient, amountGrains);
    }

    function requestExit(string calldata pearlRecipient, uint256 amountGrains) external returns (bytes32 exitId) {
        require(!exitRequestPaused, "exit request paused");
        require(bytes(pearlRecipient).length > 0, "recipient required");
        _requireExitAmount(amountGrains);

        wrappedPearl.bridgeBurn(msg.sender, amountGrains);
        pendingExitGrains += amountGrains;

        uint256 nonce = ++nextExitNonce;
        exitId = keccak256(abi.encode(block.chainid, address(this), nonce, msg.sender, pearlRecipient, amountGrains));
        exits[exitId] = ExitRequest({
            requester: msg.sender,
            amountGrains: amountGrains,
            pearlRecipient: pearlRecipient,
            status: ExitStatus.Requested,
            pearlReleaseTxid: bytes32(0)
        });

        emit ExitRequested(exitId, msg.sender, pearlRecipient, amountGrains);
    }

    function processExit(bytes32 exitId, bytes32 pearlReleaseTxid) external onlyOperator {
        require(!exitProcessingPaused, "exit processing paused");
        require(pearlReleaseTxid != bytes32(0), "release txid required");
        ExitRequest storage exitRequest = exits[exitId];
        require(exitRequest.status != ExitStatus.None, "exit missing");

        if (exitRequest.status == ExitStatus.Processed) {
            require(exitRequest.pearlReleaseTxid == pearlReleaseTxid, "conflicting release txid");
            return;
        }

        require(exitRequest.status == ExitStatus.Requested, "exit not processable");
        require(releaseTxidToExitId[pearlReleaseTxid] == bytes32(0), "release txid reused");
        exitRequest.status = ExitStatus.Processed;
        exitRequest.pearlReleaseTxid = pearlReleaseTxid;
        releaseTxidToExitId[pearlReleaseTxid] = exitId;
        pendingExitGrains -= exitRequest.amountGrains;

        emit ExitProcessed(exitId, pearlReleaseTxid, msg.sender);
    }

    function refundExit(bytes32 exitId) external onlyOperator {
        ExitRequest storage exitRequest = exits[exitId];
        require(exitRequest.status == ExitStatus.Requested, "exit not refundable");

        exitRequest.status = ExitStatus.Refunded;
        pendingExitGrains -= exitRequest.amountGrains;
        wrappedPearl.mint(exitRequest.requester, exitRequest.amountGrains);

        emit ExitRefunded(exitId, exitRequest.requester, exitRequest.amountGrains, msg.sender);
    }

    function setCaps(Caps calldata newCaps) external onlyOwner {
        _validateCaps(newCaps);
        require(
            wrappedPearl.totalSupply() + pendingExitGrains <= newCaps.pilotSupplyCapGrains,
            "pilot cap below liabilities"
        );
        caps = newCaps;
        emit CapsUpdated(newCaps);
    }

    function setRelayer(address relayer, bool enabled) external onlyOwner {
        require(relayer != address(0), "relayer required");
        if (enabled) {
            require(relayer != owner(), "relayer is owner");
            require(relayer != pendingOwner(), "relayer is pending owner");
            require(!operators[relayer], "relayer is operator");
        }
        relayers[relayer] = enabled;
        emit RelayerUpdated(relayer, enabled);
    }

    function setOperator(address operator, bool enabled) external onlyOwner {
        require(operator != address(0), "operator required");
        if (enabled) {
            require(operator != owner(), "operator is owner");
            require(operator != pendingOwner(), "operator is pending owner");
            require(!relayers[operator], "operator is relayer");
        }
        operators[operator] = enabled;
        emit OperatorUpdated(operator, enabled);
    }

    function setEntryPaused(bool paused) external onlyOwner {
        entryPaused = paused;
        emit EntryPaused(msg.sender, paused);
    }

    function setExitRequestPaused(bool paused) external onlyOwner {
        exitRequestPaused = paused;
        emit ExitRequestPaused(msg.sender, paused);
    }

    function setExitProcessingPaused(bool paused) external onlyOwner {
        exitProcessingPaused = paused;
        emit ExitProcessingPaused(msg.sender, paused);
    }

    function depositClaimId(bytes32 pearlTxid, uint32 vout) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(pearlTxid, vout));
    }

    function renounceOwnership() public view override onlyOwner {
        revert("renounce disabled");
    }

    function transferOwnership(address newOwner) public override onlyOwner {
        if (newOwner != address(0)) {
            require(!relayers[newOwner], "owner is relayer");
            require(!operators[newOwner], "owner is operator");
        }
        super.transferOwnership(newOwner);
    }

    function _consumeMintCapacity(uint256 amountGrains) private {
        Caps memory currentCaps = caps;

        require(
            wrappedPearl.totalSupply() + pendingExitGrains + amountGrains <= currentCaps.pilotSupplyCapGrains,
            "pilot cap exceeded"
        );

        if (currentCaps.rollingWindowSeconds == 0 || currentCaps.rollingWindowMintCapGrains == 0) {
            return;
        }

        if (block.timestamp >= currentWindowStart + currentCaps.rollingWindowSeconds) {
            currentWindowStart = block.timestamp;
            currentWindowMintedGrains = 0;
        }

        require(
            currentWindowMintedGrains + amountGrains <= currentCaps.rollingWindowMintCapGrains,
            "rolling cap exceeded"
        );
        currentWindowMintedGrains += amountGrains;
    }

    function _requireDepositAmount(uint256 amountGrains) private view {
        Caps memory currentCaps = caps;
        require(amountGrains >= currentCaps.minDepositGrains, "deposit below minimum");
        require(amountGrains <= currentCaps.maxDepositGrains, "deposit above maximum");
    }

    function _requireExitAmount(uint256 amountGrains) private view {
        Caps memory currentCaps = caps;
        require(amountGrains >= currentCaps.minExitGrains, "exit below minimum");
        require(amountGrains <= currentCaps.maxExitGrains, "exit above maximum");
    }

    function _validateCaps(Caps memory newCaps) private pure {
        require(newCaps.minDepositGrains > 0, "min deposit required");
        require(newCaps.maxDepositGrains >= newCaps.minDepositGrains, "invalid deposit caps");
        require(newCaps.minExitGrains > 0, "min exit required");
        require(newCaps.maxExitGrains >= newCaps.minExitGrains, "invalid exit caps");
        require(newCaps.pilotSupplyCapGrains >= newCaps.maxDepositGrains, "pilot cap too small");
        require(newCaps.pilotSupplyCapGrains >= newCaps.maxExitGrains, "pilot cap below exit max");
        if (newCaps.rollingWindowMintCapGrains > 0) {
            require(newCaps.rollingWindowSeconds > 0, "rolling window required");
            require(newCaps.rollingWindowMintCapGrains >= newCaps.minDepositGrains, "rolling cap too small");
            require(newCaps.rollingWindowMintCapGrains <= newCaps.pilotSupplyCapGrains, "rolling cap above pilot");
        }
    }

    function _requireRelayer() private view {
        require(relayers[msg.sender], "not relayer");
    }

    function _requireOperator() private view {
        require(operators[msg.sender], "not operator");
    }
}
