// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PrlUsdcEscrow} from "../src/PrlUsdcEscrow.sol";

interface Vm {
    function envAddress(string calldata name) external view returns (address);
    function envUint(string calldata name) external view returns (uint256);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployBaseSepolia {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address internal constant BASE_SEPOLIA_USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84532;

    function run() external returns (PrlUsdcEscrow escrow) {
        require(block.chainid == BASE_SEPOLIA_CHAIN_ID, "Base Sepolia only");

        address feeRecipient = VM.envAddress("USDC_ESCROW_FEE_RECIPIENT");
        uint256 deployerPrivateKey = VM.envUint("BASE_SEPOLIA_DEPLOYER_PRIVATE_KEY");

        VM.startBroadcast(deployerPrivateKey);
        escrow = new PrlUsdcEscrow(feeRecipient, BASE_SEPOLIA_USDC);
        VM.stopBroadcast();
    }
}
