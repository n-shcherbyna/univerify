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

    function _selfCall(bytes memory data) internal {
        vm.prank(a);
        uint256 id = ms.submit(address(ms), 0, data);
        vm.prank(b);
        ms.confirm(id);
        vm.prank(a);
        ms.execute(id);
    }

    function testRotationRequiresSelfCall() public {
        // Direct call from an owner is rejected — must go through m-of-n.
        vm.prank(a);
        vm.expectRevert(RegistryMultisig.OnlySelf.selector);
        ms.addOwner(address(0xD4));
    }

    function testAddOwnerViaMultisig() public {
        _selfCall(abi.encodeCall(RegistryMultisig.addOwner, (address(0xD4))));
        assertTrue(ms.isOwner(address(0xD4)));
        assertEq(ms.ownerCount(), 4);
    }

    function testRemoveOwnerViaMultisig() public {
        _selfCall(abi.encodeCall(RegistryMultisig.removeOwner, (c)));
        assertFalse(ms.isOwner(c));
        assertEq(ms.ownerCount(), 2);
    }

    function testRemoveOwnerBelowThresholdReverts() public {
        // 3 owners, threshold 2 → removing one is fine, removing to below threshold is not.
        _selfCall(abi.encodeCall(RegistryMultisig.removeOwner, (c))); // now 2 owners, threshold 2
        // Removing another would leave 1 owner < threshold 2 → inner call reverts → CallFailed.
        vm.prank(a);
        uint256 id = ms.submit(address(ms), 0, abi.encodeCall(RegistryMultisig.removeOwner, (b)));
        vm.prank(b);
        ms.confirm(id);
        vm.prank(a);
        vm.expectRevert(RegistryMultisig.CallFailed.selector);
        ms.execute(id);
    }

    function testChangeThresholdViaMultisig() public {
        _selfCall(abi.encodeCall(RegistryMultisig.changeThreshold, (uint256(3))));
        assertEq(ms.threshold(), 3);
    }

    function testRemovedOwnerConfirmationStopsCounting() public {
        // c confirms a pending tx, then c is removed via m-of-n (a+b).
        // c's stale confirmation must no longer count toward threshold.
        vm.prank(a);
        uint256 id = ms.submit(address(counter), 0, abi.encodeCall(Counter.bump, (7)));
        vm.prank(c);
        ms.confirm(id);
        assertEq(ms.confirmationCount(id), 2); // a (auto) + c

        _selfCall(abi.encodeCall(RegistryMultisig.removeOwner, (c)));
        assertEq(ms.confirmationCount(id), 1); // only a remains a current owner

        // With threshold 2 and only a's confirmation, execute must revert.
        vm.prank(a);
        vm.expectRevert(RegistryMultisig.NotEnoughConfirmations.selector);
        ms.execute(id);
    }
}
