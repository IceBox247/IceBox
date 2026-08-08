// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Standard, audited-pattern ERC-20 from OpenZeppelin.
// Remix resolves these imports automatically from npm.
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ICE USD
 * @notice IceBox's own BEP-20 reward token on BNB Smart Chain.
 *
 * This is a plain fixed-utility token: no fees, no rebasing, no hidden mint,
 * no price/peg logic. Its market value (if any) is whatever real liquidity you
 * provide on a DEX — the contract makes no claim about being worth $1 or being
 * a stablecoin. Distribute it honestly.
 *
 * The owner can mint additional supply (e.g. to top up the rewards payout
 * wallet). Renounce ownership if you want the supply permanently fixed.
 */
contract IceUsd is ERC20, Ownable {
    constructor(uint256 initialSupplyWholeTokens)
        ERC20("ICE USD", "USD")
        Ownable(msg.sender)
    {
        _mint(msg.sender, initialSupplyWholeTokens * 10 ** decimals());
    }

    /// @notice Mint more tokens (owner only) — e.g. to fund reward payouts.
    function mint(address to, uint256 amountWholeTokens) external onlyOwner {
        _mint(to, amountWholeTokens * 10 ** decimals());
    }
}
