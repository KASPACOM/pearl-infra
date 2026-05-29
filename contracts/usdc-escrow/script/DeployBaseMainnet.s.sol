// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PrlUsdcEscrow} from "../src/PrlUsdcEscrow.sol";

interface Vm {
    function envAddress(string calldata name) external view returns (address);
    function envUint(string calldata name) external view returns (uint256);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployBaseMainnet {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address internal constant BASE_MAINNET_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    uint256 internal constant BASE_MAINNET_CHAIN_ID = 8453;

    function run() external returns (PrlUsdcEscrow escrow) {
        require(block.chainid == BASE_MAINNET_CHAIN_ID, "Base mainnet only");

        address feeRecipient = VM.envAddress("USDC_ESCROW_FEE_RECIPIENT");
        uint256 deployerPrivateKey = VM.envUint("BASE_MAINNET_DEPLOYER_PRIVATE_KEY");

        VM.startBroadcast(deployerPrivateKey);
        escrow = new PrlUsdcEscrow(feeRecipient, BASE_MAINNET_USDC);
        VM.stopBroadcast();
    }
}
