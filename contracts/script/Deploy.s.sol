// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/DiplomaRegistry.sol";

contract Deploy is Script {
    function run() external {
        // zaczyna podpisywać i wysyłać tx
        vm.startBroadcast();

        DiplomaRegistry registry = new DiplomaRegistry();

        vm.stopBroadcast();
    }
}
