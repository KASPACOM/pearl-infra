// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PrlUsdcEscrow} from "../src/PrlUsdcEscrow.sol";

interface Vm {
    function envAddress(string calldata name) external view returns (address);
    function envUint(string calldata name) external view returns (uint256);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract RunBaseSepoliaNativeEscrow {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84532;
    IERC20 internal constant BASE_SEPOLIA_USDC = IERC20(0x036CbD53842c5426634e7929541eC2318f3dCF7e);
    PrlUsdcEscrow internal constant ESCROW = PrlUsdcEscrow(0x7edf75ceB2441d80aBC6599CeB4E62Eeb23BB2a9);

    bytes32 internal constant TRADE_ID = keccak256("base-sepolia-native-usdc-escrow-run-2026-05-17");
    uint256 internal constant SELLER_AMOUNT = 10_000_000;
    uint256 internal constant FEE_AMOUNT = 1_000_000;

    function run() external returns (PrlUsdcEscrow escrow) {
        require(block.chainid == BASE_SEPOLIA_CHAIN_ID, "Base Sepolia only");

        uint256 deployerPrivateKey = VM.envUint("BASE_SEPOLIA_DEPLOYER_PRIVATE_KEY");
        address deployer = VM.envAddress("BASE_SEPOLIA_DEPLOYER");
        address seller = VM.envAddress("USDC_ESCROW_TEST_SELLER");
        address newOwner = VM.envAddress("USDC_ESCROW_TEST_OWNER");

        require(ESCROW.owner() == deployer, "deployer not owner");
        require(ESCROW.usdcToken() == address(BASE_SEPOLIA_USDC), "unexpected token");
        require(BASE_SEPOLIA_USDC.balanceOf(deployer) >= SELLER_AMOUNT + FEE_AMOUNT, "insufficient USDC");

        VM.startBroadcast(deployerPrivateKey);
        ESCROW.createTrade(TRADE_ID, deployer, seller, SELLER_AMOUNT, FEE_AMOUNT, uint64(block.timestamp + 7 days));
        require(BASE_SEPOLIA_USDC.approve(address(ESCROW), SELLER_AMOUNT + FEE_AMOUNT), "approve failed");
        ESCROW.deposit(TRADE_ID);
        ESCROW.release(TRADE_ID);
        ESCROW.transferOwnership(newOwner);
        VM.stopBroadcast();

        return ESCROW;
    }
}
