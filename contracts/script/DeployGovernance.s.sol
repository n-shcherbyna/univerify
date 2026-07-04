// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {RegistryMultisig} from "../src/RegistryMultisig.sol";
import {DiplomaRegistry} from "../src/DiplomaRegistry.sol";

/// Deploys RegistryMultisig + TimelockController and hands DiplomaRegistry
/// ownership to the timelock. Reads:
///   REGISTRY_ADDRESS  — existing registry
///   GOV_OWNERS        — comma-separated owner addresses (via env in run())
///   GOV_THRESHOLD     — m
///   GOV_MIN_DELAY     — timelock delay in seconds
contract DeployGovernance is Script {
    function run() external {
        address registryAddr = vm.envAddress("REGISTRY_ADDRESS");
        address[] memory owners = vm.envAddress("GOV_OWNERS", ",");
        uint256 threshold = vm.envUint("GOV_THRESHOLD");
        uint256 minDelay = vm.envUint("GOV_MIN_DELAY");

        vm.startBroadcast();

        RegistryMultisig ms = new RegistryMultisig(owners, threshold);

        address[] memory proposers = new address[](1);
        proposers[0] = address(ms);
        address[] memory executors = new address[](1);
        executors[0] = address(0);
        TimelockController timelock = new TimelockController(minDelay, proposers, executors, address(0));

        // Step 1 of handover: current owner (broadcaster) sets pendingOwner.
        DiplomaRegistry(registryAddr).transferOwnership(address(timelock));

        vm.stopBroadcast();

        string memory path = string.concat(
            vm.projectRoot(), "/deployments/governance-", vm.toString(block.chainid), ".json"
        );
        string memory json = string.concat(
            "{\n",
            '  "chainId": ', vm.toString(block.chainid), ",\n",
            '  "multisig": "', vm.toString(address(ms)), '",\n',
            '  "timelock": "', vm.toString(address(timelock)), '",\n',
            '  "minDelay": ', vm.toString(minDelay), ",\n",
            '  "threshold": ', vm.toString(threshold), "\n",
            "}\n"
        );
        vm.writeFile(path, json);

        console2.log("RegistryMultisig:", address(ms));
        console2.log("TimelockController:", address(timelock));
        console2.log("Registry pendingOwner set to timelock. Run `gov bootstrap` to accept.");
    }
}
