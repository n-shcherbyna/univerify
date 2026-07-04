// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {RegistryMultisig} from "../src/RegistryMultisig.sol";

/// A trivial call target used to prove `execute` forwards calls.
contract Counter {
    uint256 public n;
    function bump(uint256 by) external { n += by; }
    function boom() external pure { revert("boom"); }
}

contract RegistryMultisigTest is Test {
    RegistryMultisig ms;
    Counter counter;

    address a = address(0xA1);
    address b = address(0xB2);
    address c = address(0xC3);
    address outsider = address(0xBAD);

    function setUp() public {
        address[] memory owners = new address[](3);
        owners[0] = a; owners[1] = b; owners[2] = c;
        ms = new RegistryMultisig(owners, 2);
        counter = new Counter();
    }

    function _submitBump(address who, uint256 by) internal returns (uint256 id) {
        vm.prank(who);
        id = ms.submit(address(counter), 0, abi.encodeCall(Counter.bump, (by)));
    }

    function testSubmitAutoConfirms() public {
        uint256 id = _submitBump(a, 5);
        assertEq(ms.confirmationCount(id), 1);
        assertTrue(ms.confirmed(id, a));
    }

    function testExecuteRequiresThreshold() public {
        uint256 id = _submitBump(a, 5);
        vm.prank(a);
        vm.expectRevert(RegistryMultisig.NotEnoughConfirmations.selector);
        ms.execute(id);

        vm.prank(b);
        ms.confirm(id);
        vm.prank(a);
        ms.execute(id);
        assertEq(counter.n(), 5);
    }

    function testNonOwnerRejected() public {
        vm.prank(outsider);
        vm.expectRevert(RegistryMultisig.NotOwner.selector);
        ms.submit(address(counter), 0, "");
    }

    function testDoubleConfirmReverts() public {
        uint256 id = _submitBump(a, 1);
        vm.prank(a);
        vm.expectRevert(RegistryMultisig.AlreadyConfirmed.selector);
        ms.confirm(id);
    }

    function testRevokeLowersCount() public {
        uint256 id = _submitBump(a, 1);
        vm.prank(b);
        ms.confirm(id);
        assertEq(ms.confirmationCount(id), 2);
        vm.prank(b);
        ms.revoke(id);
        assertEq(ms.confirmationCount(id), 1);
    }

    function testDoubleExecuteReverts() public {
        uint256 id = _submitBump(a, 1);
        vm.prank(b);
        ms.confirm(id);
        vm.prank(a);
        ms.execute(id);
        vm.prank(a);
        vm.expectRevert(RegistryMultisig.AlreadyExecuted.selector);
        ms.execute(id);
    }

    function testExecuteRevertsOnInnerFailure() public {
        vm.prank(a);
        uint256 id = ms.submit(address(counter), 0, abi.encodeCall(Counter.boom, ()));
        vm.prank(b);
        ms.confirm(id);
        vm.prank(a);
        vm.expectRevert(RegistryMultisig.CallFailed.selector);
        ms.execute(id);
    }

    function testConstructorRejectsBadThreshold() public {
        address[] memory owners = new address[](2);
        owners[0] = a; owners[1] = b;
        vm.expectRevert(RegistryMultisig.InvalidThreshold.selector);
        new RegistryMultisig(owners, 3);
    }

    function testConstructorRejectsDuplicateOwner() public {
        address[] memory owners = new address[](2);
        owners[0] = a; owners[1] = a;
        vm.expectRevert(RegistryMultisig.DuplicateOwner.selector);
        new RegistryMultisig(owners, 1);
    }
}
