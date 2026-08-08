// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title CustomToken
 * @notice A plain, self-contained ERC-20 minted entirely to its owner.
 * Deployed by TokenFactory on behalf of a customer, who becomes the owner.
 */
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
        uint256 _supplyWholeTokens,
        address _owner
    ) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
        owner = _owner;
        emit OwnershipTransferred(address(0), _owner);
        uint256 amount = _supplyWholeTokens * (10 ** uint256(_decimals));
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
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= value, "allowance");
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - value;
        _transfer(from, to, value);
        return true;
    }

    function mint(address to, uint256 amountWholeTokens) external onlyOwner {
        uint256 amount = amountWholeTokens * (10 ** uint256(decimals));
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
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
}

/**
 * @title TokenFactory
 * @notice Lets anyone deploy their own CustomToken in one transaction, paying a
 * fee (in BNB) that is forwarded to the factory's fee receiver. The customer
 * (msg.sender) becomes the owner of the new token. The factory owner can tune
 * the fee and change the receiver, but never holds anyone's tokens or keys.
 */
contract TokenFactory {
    address public owner;
    address payable public feeReceiver;
    uint256 public fee; // in wei (BNB)
    uint256 public tokenCount;

    event TokenCreated(
        address indexed token,
        address indexed creator,
        string name,
        string symbol,
        uint256 supplyWholeTokens
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

    /// @notice Deploy a new token owned by the caller. Send `fee` as msg.value.
    function createToken(
        string calldata _name,
        string calldata _symbol,
        uint8 _decimals,
        uint256 _supplyWholeTokens
    ) external payable returns (address) {
        require(msg.value >= fee, "insufficient fee");
        (bool ok, ) = feeReceiver.call{value: msg.value}("");
        require(ok, "fee transfer failed");

        CustomToken token = new CustomToken(
            _name,
            _symbol,
            _decimals,
            _supplyWholeTokens,
            msg.sender
        );
        tokenCount++;
        emit TokenCreated(address(token), msg.sender, _name, _symbol, _supplyWholeTokens);
        return address(token);
    }

    function setFee(uint256 _fee) external onlyOwner {
        fee = _fee;
        emit FeeUpdated(_fee);
    }

    function setFeeReceiver(address payable _receiver) external onlyOwner {
        require(_receiver != address(0), "zero receiver");
        feeReceiver = _receiver;
        emit FeeReceiverUpdated(_receiver);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
