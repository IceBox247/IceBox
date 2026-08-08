// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ICE USD
 * @notice IceBox's own BEP-20 reward token on BNB Smart Chain.
 *
 * A plain, self-contained ERC-20 (no external imports so it compiles anywhere):
 * no fees, no rebasing, no hidden mint, no price/peg logic. Its market value —
 * if any — is only whatever real liquidity you provide on a DEX. The contract
 * makes NO claim about being worth $1 or being a stablecoin.
 *
 * The owner can mint more supply (e.g. to fund reward payouts) and can renounce
 * ownership to make the supply permanently fixed.
 */
contract IceUsd {
    string public name = "ICE USD";
    string public symbol = "USD";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    address public owner;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    /// @param initialSupplyWholeTokens supply in whole tokens (e.g. 1000000000).
    constructor(uint256 initialSupplyWholeTokens) {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
        _mint(msg.sender, initialSupplyWholeTokens * 10 ** uint256(decimals));
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= value, "allowance");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - value;
        }
        _transfer(from, to, value);
        return true;
    }

    /// @notice Mint more tokens (owner only) — e.g. to fund reward payouts.
    function mint(address to, uint256 amountWholeTokens) external onlyOwner {
        _mint(to, amountWholeTokens * 10 ** uint256(decimals));
    }

    function transferOwnership(address newOwner) external onlyOwner {
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function renounceOwnership() external onlyOwner {
        emit OwnershipTransferred(owner, address(0));
        owner = address(0);
    }

    function _transfer(address from, address to, uint256 value) internal {
        require(to != address(0), "zero address");
        uint256 bal = balanceOf[from];
        require(bal >= value, "balance too low");
        unchecked {
            balanceOf[from] = bal - value;
        }
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }

    function _mint(address to, uint256 value) internal {
        require(to != address(0), "zero address");
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }
}
