// AUTO-GENERATED from contracts/TokenFactory.sol — do not edit by hand.
// The exact source the IceBox factory compiled (solc 0.8.26, optimizer 200 runs),
// used to auto-verify factory-created tokens on BscScan.
export const TOKEN_FACTORY_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/* ------------------------------------------------------------------ *
 *  IceBox Token Factory (v2)
 *  - Standard token: plain ERC-20, whole supply to the owner.
 *  - Tax token: buy/sell tax capped at 20%, always sellable, no
 *    blacklist / trading-switch / stealth mint. The cap is enforced in
 *    the contract, so not even the owner can make a honeypot.
 * ------------------------------------------------------------------ */

uint16 constant MAX_TAX_BPS = 2000; // 20.00%

/// @notice Plain, self-contained ERC-20 minted entirely to its owner.
contract CustomToken {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
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

    constructor(
        string memory _name,
        string memory _symbol,
        uint8 _decimals,
        uint256 _supplyWhole,
        address _owner
    ) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
        owner = _owner;
        emit OwnershipTransferred(address(0), _owner);
        uint256 amount = _supplyWhole * (10 ** uint256(_decimals));
        totalSupply = amount;
        balanceOf[_owner] = amount;
        emit Transfer(address(0), _owner, amount);
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
        uint256 a = allowance[from][msg.sender];
        require(a >= value, "allowance");
        if (a != type(uint256).max) allowance[from][msg.sender] = a - value;
        _transfer(from, to, value);
        return true;
    }

    function mint(address to, uint256 amountWhole) external onlyOwner {
        uint256 amount = amountWhole * (10 ** uint256(decimals));
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function transferOwnership(address n) external onlyOwner {
        emit OwnershipTransferred(owner, n);
        owner = n;
    }

    function renounceOwnership() external onlyOwner {
        emit OwnershipTransferred(owner, address(0));
        owner = address(0);
    }

    function _transfer(address from, address to, uint256 value) internal {
        require(to != address(0), "zero address");
        uint256 b = balanceOf[from];
        require(b >= value, "balance too low");
        unchecked {
            balanceOf[from] = b - value;
        }
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}

/// @notice ERC-20 with a capped, transparent buy/sell tax. Always sellable.
contract TaxToken {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;
    address public owner;

    uint16 public buyTaxBps;
    uint16 public sellTaxBps;
    address public taxWallet;
    address public pair; // the DEX pair; set by owner after creating liquidity
    uint16 public constant maxTaxBps = MAX_TAX_BPS;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public isExcludedFromFee;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event TaxesUpdated(uint16 buyTaxBps, uint16 sellTaxBps);
    event TaxWalletUpdated(address wallet);
    event PairUpdated(address pair);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(
        string memory _name,
        string memory _symbol,
        uint8 _decimals,
        uint256 _supplyWhole,
        address _owner,
        uint16 _buyTaxBps,
        uint16 _sellTaxBps,
        address _taxWallet
    ) {
        require(_buyTaxBps <= MAX_TAX_BPS && _sellTaxBps <= MAX_TAX_BPS, "tax too high");
        require(_taxWallet != address(0), "zero tax wallet");
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
        owner = _owner;
        buyTaxBps = _buyTaxBps;
        sellTaxBps = _sellTaxBps;
        taxWallet = _taxWallet;

        isExcludedFromFee[_owner] = true;
        isExcludedFromFee[_taxWallet] = true;
        isExcludedFromFee[address(this)] = true;

        emit OwnershipTransferred(address(0), _owner);
        uint256 amount = _supplyWhole * (10 ** uint256(_decimals));
        totalSupply = amount;
        balanceOf[_owner] = amount;
        emit Transfer(address(0), _owner, amount);
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
        uint256 a = allowance[from][msg.sender];
        require(a >= value, "allowance");
        if (a != type(uint256).max) allowance[from][msg.sender] = a - value;
        _transfer(from, to, value);
        return true;
    }

    // --- owner controls (all bounded; none can block selling) ---

    function setTaxes(uint16 _buyTaxBps, uint16 _sellTaxBps) external onlyOwner {
        require(_buyTaxBps <= MAX_TAX_BPS && _sellTaxBps <= MAX_TAX_BPS, "tax too high");
        buyTaxBps = _buyTaxBps;
        sellTaxBps = _sellTaxBps;
        emit TaxesUpdated(_buyTaxBps, _sellTaxBps);
    }

    function setTaxWallet(address w) external onlyOwner {
        require(w != address(0), "zero");
        taxWallet = w;
        emit TaxWalletUpdated(w);
    }

    function setPair(address p) external onlyOwner {
        pair = p;
        emit PairUpdated(p);
    }

    function setExcludedFromFee(address a, bool ex) external onlyOwner {
        isExcludedFromFee[a] = ex;
    }

    function transferOwnership(address n) external onlyOwner {
        emit OwnershipTransferred(owner, n);
        owner = n;
    }

    function renounceOwnership() external onlyOwner {
        emit OwnershipTransferred(owner, address(0));
        owner = address(0);
    }

    function _transfer(address from, address to, uint256 value) internal {
        require(to != address(0), "zero address");
        uint256 b = balanceOf[from];
        require(b >= value, "balance too low");
        unchecked {
            balanceOf[from] = b - value;
        }

        uint256 feeBps = 0;
        if (pair != address(0) && !isExcludedFromFee[from] && !isExcludedFromFee[to]) {
            if (from == pair) feeBps = buyTaxBps; // buy
            else if (to == pair) feeBps = sellTaxBps; // sell
        }

        uint256 fee = (value * feeBps) / 10000;
        uint256 net = value - fee;
        if (fee > 0) {
            balanceOf[taxWallet] += fee;
            emit Transfer(from, taxWallet, fee);
        }
        balanceOf[to] += net;
        emit Transfer(from, to, net);
    }
}

/// @notice Deploys standard or tax tokens for a fee (BNB) forwarded to the receiver.
contract TokenFactory {
    address public owner;
    address payable public feeReceiver;
    uint256 public fee; // wei
    uint256 public tokenCount;
    uint16 public constant maxTaxBps = MAX_TAX_BPS;

    event TokenCreated(
        address indexed token,
        address indexed creator,
        string name,
        string symbol,
        uint256 supplyWhole,
        bool taxed
    );
    event FeeUpdated(uint256 fee);
    event FeeReceiverUpdated(address receiver);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(address payable _feeReceiver, uint256 _fee) {
        require(_feeReceiver != address(0), "zero receiver");
        owner = msg.sender;
        feeReceiver = _feeReceiver;
        fee = _fee;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function _collectFee() internal {
        require(msg.value >= fee, "insufficient fee");
        (bool ok, ) = feeReceiver.call{value: msg.value}("");
        require(ok, "fee transfer failed");
    }

    /// @notice Deploy a plain token owned by the caller.
    function createToken(
        string calldata _name,
        string calldata _symbol,
        uint8 _decimals,
        uint256 _supplyWhole
    ) external payable returns (address) {
        _collectFee();
        CustomToken token = new CustomToken(_name, _symbol, _decimals, _supplyWhole, msg.sender);
        tokenCount++;
        emit TokenCreated(address(token), msg.sender, _name, _symbol, _supplyWhole, false);
        return address(token);
    }

    /// @notice Deploy a tax token owned by the caller. Taxes capped at 20%.
    function createTaxToken(
        string calldata _name,
        string calldata _symbol,
        uint8 _decimals,
        uint256 _supplyWhole,
        uint16 _buyTaxBps,
        uint16 _sellTaxBps,
        address _taxWallet
    ) external payable returns (address) {
        require(_buyTaxBps <= MAX_TAX_BPS && _sellTaxBps <= MAX_TAX_BPS, "tax too high");
        _collectFee();
        TaxToken token = new TaxToken(
            _name,
            _symbol,
            _decimals,
            _supplyWhole,
            msg.sender,
            _buyTaxBps,
            _sellTaxBps,
            _taxWallet
        );
        tokenCount++;
        emit TokenCreated(address(token), msg.sender, _name, _symbol, _supplyWhole, true);
        return address(token);
    }

    function setFee(uint256 _fee) external onlyOwner {
        fee = _fee;
        emit FeeUpdated(_fee);
    }

    function setFeeReceiver(address payable _r) external onlyOwner {
        require(_r != address(0), "zero receiver");
        feeReceiver = _r;
        emit FeeReceiverUpdated(_r);
    }

    function transferOwnership(address n) external onlyOwner {
        emit OwnershipTransferred(owner, n);
        owner = n;
    }
}
`;
