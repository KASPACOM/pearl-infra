// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {PrlUsdcEscrow} from "../src/PrlUsdcEscrow.sol";

interface Vm {
    function envAddress(string calldata name) external view returns (address);
    function envUint(string calldata name) external view returns (uint256);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract BaseSepoliaMockUsdc is ERC20 {
    constructor() ERC20("Base Sepolia Mock USDC", "mUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }
}

contract RunBaseSepoliaMockEscrow {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84532;
    bytes32 internal constant TRADE_ID = keccak256("base-sepolia-mock-escrow-run-2026-05-17");
    uint256 internal constant SELLER_AMOUNT = 100_000_000;
    uint256 internal constant FEE_AMOUNT = 1_000_000;

    function run() external returns (BaseSepoliaMockUsdc token, PrlUsdcEscrow escrow) {
        require(block.chainid == BASE_SEPOLIA_CHAIN_ID, "Base Sepolia only");

        uint256 deployerPrivateKey = VM.envUint("BASE_SEPOLIA_DEPLOYER_PRIVATE_KEY");
        address deployer = VM.envAddress("BASE_SEPOLIA_DEPLOYER");
        address feeRecipient = VM.envAddress("USDC_ESCROW_FEE_RECIPIENT");
        address seller = VM.envAddress("USDC_ESCROW_TEST_SELLER");
        address newOwner = VM.envAddress("USDC_ESCROW_TEST_OWNER");

        VM.startBroadcast(deployerPrivateKey);
        token = new BaseSepoliaMockUsdc();
        escrow = new PrlUsdcEscrow(feeRecipient, address(token));

        token.mint(deployer, SELLER_AMOUNT + FEE_AMOUNT);
        escrow.createTrade(TRADE_ID, deployer, seller, SELLER_AMOUNT, FEE_AMOUNT, uint64(block.timestamp + 7 days));
        token.approve(address(escrow), SELLER_AMOUNT + FEE_AMOUNT);
        escrow.deposit(TRADE_ID, seller, SELLER_AMOUNT, FEE_AMOUNT);
        escrow.release(TRADE_ID);
        escrow.transferOwnership(newOwner);
        VM.stopBroadcast();
    }
}
