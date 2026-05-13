// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/DiplomaRegistry.sol";

contract Deploy is Script {
    function run() external returns (DiplomaRegistry registry) {
        vm.startBroadcast();
        registry = new DiplomaRegistry();
        registry.onboardIssuerAndUniversity(
            tx.origin,
            1,
            "Bench University",
            "PL",
            "https://bench.invalid",
            "BENCH-001"
        );
        vm.stopBroadcast();

        uint256 chainId = block.chainid;
        address addr = address(registry);

        string memory path = string.concat(
            "deployments/",
            vm.toString(chainId),
            ".json"
        );

        uint256 deployBlock = block.number;

        // minimalny JSON, łatwy do parsowania
        string memory json = string.concat(
            "{\n",
            '  "chainId": ', vm.toString(chainId), ",\n",
            '  "DiplomaRegistry": "', vm.toString(addr), '",\n',
            '  "deployBlock": ', vm.toString(deployBlock), "\n",
            "}\n"
        );

        vm.writeFile(path, json);

        console2.log("Deployed DiplomaRegistry:", addr);
        console2.log("Deploy block:", deployBlock);
        console2.log("Saved deployment file:", path);
    }
}
