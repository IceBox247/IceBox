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
 * ---------------------------------------------------------------------------
 * LAUNCH SELL LOCK
 * ---------------------------------------------------------------------------
 * Optionally, selling into the DEX pair can be blocked for a short window after
 * deployment, so airdrop recipients hold while liquidity is being built up.
 * Holders can still receive, hold and transfer their tokens during the lock —
 * only the sell into the pair is blocked.
 *
 * The lock is deliberately bounded so it cannot be abused:
 *
 *  - `sellLockUntil` is IMMUTABLE. It is fixed at deployment and there is no
 *    function anywhere that can extend it. Not even the owner.
 *  - `MAX_SELL_LOCK` caps it at 7 days. The constructor reverts above that.
 *  - The owner can only ever SHORTEN it, via `unlockSellsEarly()`. Once
 *    unlocked, it can never be re-locked.
 *  - `pair` can be set exactly once and never changed afterwards.
 *
 * Anyone can verify the unlock time on-chain before buying by reading
 * `sellLockUntil()` / `sellLockActive()`.
 *
 * Be aware: while the lock is active, automated screeners (honeypot checkers,
 * DEX analytics) will flag this token as non-sellable, because they cannot
 * distinguish a time-boxed launch lock from a permanent one. That is expected
 * for the duration of the window.
 */
contract IceUsd {
    string public name = "ICE USD";
    string public symbol = "USD";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    address public owner;

    /// @notice Hard ceiling on the launch lock. Enforced in the constructor.
    uint256 public constant MAX_SELL_LOCK = 7 days;

    /// @notice Unix time after which selling into `pair` is allowed. Immutable.
    uint256 public immutable sellLockUntil;

    /// @notice The DEX pair. Settable once by the owner, then frozen forever.
    address public pair;
    bool public pairFrozen;

    /// @notice Set by `unlockSellsEarly()`. One-way: sells can never be re-locked.
    bool public sellsUnlockedEarly;

    /// @notice Addresses allowed to move tokens during the lock (owner, liquidity
    /// helper contracts). Cannot be used to block anyone — only to permit.
    mapping(address => bool) public isLockExempt;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PairSet(address indexed pair);
    event SellsUnlockedEarly(uint256 at);
    event LockExemptSet(address indexed account, bool exempt);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    /**
     * @param initialSupplyWholeTokens supply in whole tokens (e.g. 1000000000).
     * @param sellLockSeconds how long sells stay blocked, in seconds. Pass 0 for
     *        no lock at all. Must be <= MAX_SELL_LOCK (7 days).
     */
    constructor(uint256 initialSupplyWholeTokens, uint256 sellLockSeconds) {
        require(sellLockSeconds <= MAX_SELL_LOCK, "lock exceeds 7 days");
        sellLockUntil = sellLockSeconds == 0 ? 0 : block.timestamp + sellLockSeconds;

        owner = msg.sender;
        isLockExempt[msg.sender] = true;
        emit OwnershipTransferred(address(0), msg.sender);
        emit LockExemptSet(msg.sender, true);
        _mint(msg.sender, initialSupplyWholeTokens * 10 ** uint256(decimals));
    }

    /// @notice True while sells into the pair are still blocked.
    function sellLockActive() public view returns (bool) {
        if (sellsUnlockedEarly) return false;
        return block.timestamp < sellLockUntil;
    }

    /// @notice Seconds remaining on the lock; 0 once it has expired.
    function sellLockRemaining() external view returns (uint256) {
        if (!sellLockActive()) return 0;
        return sellLockUntil - block.timestamp;
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

    // --- launch lock controls (bounded: can only ever loosen, never tighten) ---

    /// @notice Set the DEX pair once, after creating liquidity. Cannot be changed
    /// again, so the owner cannot later point the lock at a different address.
    function setPair(address p) external onlyOwner {
        require(!pairFrozen, "pair already set");
        require(p != address(0), "zero pair");
        pair = p;
        pairFrozen = true;
        emit PairSet(p);
    }

    /// @notice End the lock ahead of schedule. One-way — there is no re-lock.
    function unlockSellsEarly() external onlyOwner {
        require(!sellsUnlockedEarly, "already unlocked");
        sellsUnlockedEarly = true;
        emit SellsUnlockedEarly(block.timestamp);
    }

    /// @notice Permit an address to sell during the lock (e.g. a router used to
    /// seed liquidity). Only grants permission; it can never block a transfer.
    function setLockExempt(address account, bool exempt) external onlyOwner {
        isLockExempt[account] = exempt;
        emit LockExemptSet(account, exempt);
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

        // The only restriction: selling into the pair during the launch window.
        // Buying, holding and wallet-to-wallet transfers are never blocked, and
        // this branch is dead code forever once the window closes.
        if (
            pair != address(0) &&
            to == pair &&
            sellLockActive() &&
            !isLockExempt[from]
        ) {
            revert("sells locked until launch window ends");
        }

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
