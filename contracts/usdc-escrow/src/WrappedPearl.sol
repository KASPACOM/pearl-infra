// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

contract WrappedPearl is ERC20, Ownable2Step {
    address public bridge;

    event BridgeUpdated(address indexed previousBridge, address indexed newBridge);

    modifier onlyBridge() {
        _requireBridge();
        _;
    }

    constructor(address initialOwner) ERC20("Wrapped Pearl", "wPRL") Ownable(initialOwner) {
        require(initialOwner != address(0), "owner required");
    }

    function decimals() public pure override returns (uint8) {
        return 8;
    }

    function setBridge(address newBridge) external onlyOwner {
        require(newBridge != address(0), "bridge required");
        require(newBridge.code.length > 0, "bridge contract required");
        address previousBridge = bridge;
        bridge = newBridge;
        emit BridgeUpdated(previousBridge, newBridge);
    }

    function mint(address to, uint256 amountGrains) external onlyBridge {
        require(to != address(0), "recipient required");
        require(amountGrains > 0, "amount required");
        _mint(to, amountGrains);
    }

    function bridgeBurn(address from, uint256 amountGrains) external onlyBridge {
        require(from != address(0), "holder required");
        require(amountGrains > 0, "amount required");
        _burn(from, amountGrains);
    }

    function renounceOwnership() public view override onlyOwner {
        revert("renounce disabled");
    }

    function _requireBridge() private view {
        require(msg.sender == bridge, "not bridge");
    }
}
