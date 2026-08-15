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
 * DECAYING LAUNCH SELL TAX (optional)
 * ---------------------------------------------------------------------------
 * Optionally, sells into the DEX pair carry a tax that steps down every day
 * after launch and then settles permanently:
 *
 *   day 1  90%   day 4  60%   day 7  30%   day 10+  5% forever
 *   day 2  80%   day 5  50%   day 8  20%
 *   day 3  70%   day 6  40%   day 9  10%
 *
 * The schedule is HARD-CODED and IMMUTABLE. There is no setter — not for the
 * owner, not for anyone. It cannot be raised, paused or extended, and it
 * reaches its 5% floor on its own with no transaction required. Callers can
 * read the entire curve up front via `sellTaxBpsAt()` and `currentSellTaxBps()`.
 *
 * Note that a tax above ~50% exceeds the slippage tolerance most DEX front-ends
 * allow, so during the first days sells will fail outright rather than execute
 * at a loss.
 *
 * ---------------------------------------------------------------------------
 * LAUNCH SELL LOCK (optional, independent of the tax)
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

    /// @notice Addresses exempt from the launch lock and the sell tax (owner,
    /// liquidity helpers). Cannot be used to block or tax anyone — only to
    /// exempt, so it can never be turned into a blacklist.
    mapping(address => bool) public isExempt;

    // --- decaying sell tax (immutable schedule; no setter exists) ---

    /// @notice Whether the decaying sell tax applies at all. Fixed at deploy.
    bool public immutable sellTaxEnabled;
    /// @notice Timestamp the schedule is measured from. Fixed at deploy.
    uint256 public immutable launchedAt;
    /// @notice Day-1 rate — the highest this token can ever tax a sell.
    uint16 public constant MAX_SELL_TAX_BPS = 9000; // 90.00%
    /// @notice The permanent rate from day 10 onward.
    uint16 public constant FINAL_SELL_TAX_BPS = 500; // 5.00%
    /// @notice Where sell tax is sent (e.g. the liquidity wallet).
    address public taxWallet;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PairSet(address indexed pair);
    event SellsUnlockedEarly(uint256 at);
    event ExemptSet(address indexed account, bool exempt);
    event TaxWalletUpdated(address indexed wallet);
    event SellTaxCollected(address indexed from, uint256 amount, uint16 bps);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    /**
     * @param initialSupplyWholeTokens supply in whole tokens (e.g. 1000000000).
     * @param sellLockSeconds how long sells stay blocked, in seconds. Pass 0 for
     *        no lock at all. Must be <= MAX_SELL_LOCK (7 days).
     */
    constructor(
        uint256 initialSupplyWholeTokens,
        uint256 sellLockSeconds,
        bool enableSellTax,
        address taxWallet_
    ) {
        require(sellLockSeconds <= MAX_SELL_LOCK, "lock exceeds 7 days");
        require(!enableSellTax || taxWallet_ != address(0), "zero tax wallet");
        sellLockUntil = sellLockSeconds == 0 ? 0 : block.timestamp + sellLockSeconds;
        sellTaxEnabled = enableSellTax;
        launchedAt = block.timestamp;
        taxWallet = taxWallet_;

        owner = msg.sender;
        isExempt[msg.sender] = true;
        if (taxWallet_ != address(0)) isExempt[taxWallet_] = true;
        emit OwnershipTransferred(address(0), msg.sender);
        emit ExemptSet(msg.sender, true);
        _mint(msg.sender, initialSupplyWholeTokens * 10 ** uint256(decimals));
    }

    // --- sell tax schedule (pure/view; no setter exists anywhere) ---

    /// @notice Sell tax in basis points at a given timestamp.
    /// Day 1 is 90%, stepping down 10 points a day, then 5% from day 10 on.
    function sellTaxBpsAt(uint256 ts) public view returns (uint16) {
        if (!sellTaxEnabled) return 0;
        if (ts <= launchedAt) return MAX_SELL_TAX_BPS;
        uint256 dayIndex = (ts - launchedAt) / 1 days; // 0 on day 1
        if (dayIndex >= 9) return FINAL_SELL_TAX_BPS;
        return uint16(MAX_SELL_TAX_BPS - dayIndex * 1000);
    }

    /// @notice Sell tax in basis points right now.
    function currentSellTaxBps() public view returns (uint16) {
        return sellTaxBpsAt(block.timestamp);
    }

    /// @notice The full schedule, one entry per day for the first 10 days.
    /// Lets buyers read the entire curve before touching the token.
    function sellTaxSchedule() external view returns (uint16[10] memory out) {
        for (uint256 i = 0; i < 10; i++) {
            out[i] = sellTaxBpsAt(launchedAt + i * 1 days + 1);
        }
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

    /// @notice Exempt an address from the lock and the sell tax (e.g. a router
    /// used to seed liquidity). Only grants exemption; it can never block or
    /// tax a transfer, so it cannot become a blacklist.
    function setExempt(address account, bool exempt) external onlyOwner {
        isExempt[account] = exempt;
        emit ExemptSet(account, exempt);
    }

    /// @notice Redirect where sell tax is sent. Cannot change any tax rate.
    function setTaxWallet(address w) external onlyOwner {
        require(w != address(0), "zero");
        taxWallet = w;
        emit TaxWalletUpdated(w);
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
        bool isSell = pair != address(0) && to == pair && !isExempt[from];

        if (isSell && sellLockActive()) {
            revert("sells locked until launch window ends");
        }

        uint256 bal = balanceOf[from];
        require(bal >= value, "balance too low");
        unchecked {
            balanceOf[from] = bal - value;
        }

        // Decaying launch tax, sells only. Buys and wallet-to-wallet transfers
        // are never taxed, and the rate is fixed by an immutable schedule.
        uint256 net = value;
        if (isSell && sellTaxEnabled) {
            uint16 bps = currentSellTaxBps();
            if (bps > 0) {
                uint256 fee = (value * bps) / 10000;
                if (fee > 0) {
                    net = value - fee;
                    balanceOf[taxWallet] += fee;
                    emit Transfer(from, taxWallet, fee);
                    emit SellTaxCollected(from, fee, bps);
                }
            }
        }

        balanceOf[to] += net;
        emit Transfer(from, to, net);
    }

    function _mint(address to, uint256 value) internal {
        require(to != address(0), "zero address");
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }
}
