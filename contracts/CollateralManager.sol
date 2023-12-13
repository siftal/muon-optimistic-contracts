// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

contract CollateralManager is Initializable, AccessControlUpgradeable {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant DISPUTE_RESOLVER = keccak256("DISPUTE_RESOLVER");

    uint256 public warrantyDuration;
    address public seizedAssetsWallet;

    enum RequestStatus {
        UNINITIALIZED,
        LOCKED,
        UNLOCKED,
        DISPUTED,
        DISPUTE_CONFIRMED,
        DISPUTE_REJECTED
    }
    struct Request {
        address warrantor;
        address asset;
        uint256 amount;
        uint256 muonAppId;
        address user;
        uint256 time;
        RequestStatus status;
        address claimer;
    }
    // requestId -> Request
    mapping(bytes32 => Request) public requests;

    // warrantorAddress -> requestIds
    mapping(address => bytes32[]) public warrantorRequests;

    // tokenAddress -> warrantorAddress -> balance
    mapping(address => mapping(address => uint256)) public balances;

    // supervisorAddress -> active(boolean)
    mapping(address => bool) public supervisors;

    event Locked(
        address indexed warrantor,
        address asset,
        uint256 amount,
        uint256 indexed muonAppId,
        address user,
        bytes32 indexed reqId
    );
    event Unlocked(
        address indexed warrantor,
        address asset,
        uint256 amount,
        uint256 indexed muonAppId,
        address user,
        bytes32 indexed reqId
    );
    event Disputed(bytes32 indexed reqId, address indexed supervisor);
    event DisputeResolved(bytes32 indexed reqId, bool result);
    event Deposited(
        address indexed warrantor,
        address indexed asset,
        uint256 amount
    );
    event Withdrawn(
        address indexed warrantor,
        address indexed asset,
        uint256 amount
    );

    /**
     * @param _seizedAssetsWallet A wallet address to transfer seized assets
     */
    function initialize(address _seizedAssetsWallet) external initializer {
        __CollateralManager_init(_seizedAssetsWallet);
    }

    function __CollateralManager_init(address _seizedAssetsWallet) internal initializer {
        __AccessControl_init();

        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _setupRole(ADMIN_ROLE, msg.sender);
        _setupRole(DISPUTE_RESOLVER, msg.sender);

        warrantyDuration = 600;
        seizedAssetsWallet = _seizedAssetsWallet;
    }

    function __CollateralManager_init_unchained()
        internal
        initializer
    {}

    /**
     * @notice Warranties the request by locking collateral
     * @param asset The address of the collateral token (ERC20 token)
     * @param amount The amount of the collateral token
     * @param muonAppId A uint that represents the app
     * @param user The user for whom this collateral is locked
     * @param reqId A hash that represents the request
     * @param unlockables A list of the request ids which can be unlocked
     */
    function lock(
        address asset,
        uint256 amount,
        uint256 muonAppId,
        address user,
        bytes32 reqId,
        bytes32[] calldata unlockables
    ) external {
        require(
            requests[reqId].status == RequestStatus.UNINITIALIZED,
            "this request already submitted"
        );

        unlock(unlockables);
        require(
            balances[asset][msg.sender] >= amount,
            "warrantor balance is not enough"
        );

        balances[asset][msg.sender] -= amount;
        requests[reqId] = Request({
            warrantor: msg.sender,
            asset: asset,
            amount: amount,
            muonAppId: muonAppId,
            user: user,
            time: block.timestamp,
            status: RequestStatus.LOCKED,
            claimer: address(0)
        });
        warrantorRequests[msg.sender].push(reqId);
        emit Locked(msg.sender, asset, amount, muonAppId, user, reqId);
    }

    /**
     * @notice releases the collateral of the expired warranties
     * @param unlockables A list of the request ids which can be unlocked
     */
    function unlock(bytes32[] calldata unlockables) public {
        for (uint256 i = 0; i < unlockables.length; i++) {
            Request memory theLock = requests[unlockables[i]];
            bool isLockedOrDisputeRejected = theLock.status == RequestStatus.LOCKED || theLock.status == RequestStatus.DISPUTE_REJECTED;
            if (theLock.time + warrantyDuration <= block.timestamp && isLockedOrDisputeRejected) {
                requests[unlockables[i]].status = RequestStatus.UNLOCKED;
                balances[theLock.asset][theLock.warrantor] += theLock.amount;
                emit Unlocked(
                    theLock.warrantor,
                    theLock.asset,
                    theLock.amount,
                    theLock.muonAppId,
                    theLock.user,
                    unlockables[i]
                );
            }
        }
    }

    /**
     * @notice Initiates a dispute by a supervisor
     * @param reqId A hash that represents a request
     */
    function dispute(bytes32 reqId) external {
        require(
            requests[reqId].status == RequestStatus.LOCKED,
            "request is not locked"
        );

        require(supervisors[msg.sender], "only supervisors can dispute");

        requests[reqId].status = RequestStatus.DISPUTED;
        requests[reqId].claimer = msg.sender;
        emit Disputed(reqId, msg.sender);
    }

    /**
     * @notice Submits the result of the dispute
     * @param reqId A hash that represents a request
     * @param result the result of the investigation of the dispute
     */
    function resolveDispute(bytes32 reqId, bool result)
        external
        onlyRole(DISPUTE_RESOLVER)
    {
        require(
            requests[reqId].status == RequestStatus.DISPUTED,
            "not disputed"
        );

        if (result) {
            requests[reqId].status = RequestStatus.DISPUTE_CONFIRMED;
            IERC20(requests[reqId].asset).safeTransfer(
                seizedAssetsWallet,
                requests[reqId].amount
            );
        } else {
            requests[reqId].status = RequestStatus.DISPUTE_REJECTED;
        }
        emit DisputeResolved(reqId, result);
    }

    /**
     * @notice Warrantors use this function to increase their balance of the assets that they are providing as collateral
     * @param asset Address of the collateral token (ERC20 token)
     * @param amount The amount of the collateral token
     */
    function deposit(address asset, uint256 amount) external {
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        balances[asset][msg.sender] += amount;
        emit Deposited(msg.sender, asset, amount);
    }

    /**
     * @notice Warrantors use this function to withdraw their assets
     * @param asset Address of the collateral token (ERC20 token)
     * @param amount The amount of the collateral token
     */
    function withdraw(address asset, uint256 amount) external {
        require(balances[asset][msg.sender] >= amount, "not enough balance");

        balances[asset][msg.sender] -= amount;
        IERC20(asset).safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, asset, amount);
    }

    /**
     * @notice Admins use this function to set warranty duration
     * @param _warrantyDuration the warranty duration in seconds
     */
    function setWarrantyDuration(uint256 _warrantyDuration)
        external
        onlyRole(ADMIN_ROLE)
    {
        warrantyDuration = _warrantyDuration;
    }

    /**
     * @notice Admins use this function to add a new supervisor
     * @param supervisor Supervisor's address
     */
    function addSupervisor(address supervisor) external onlyRole(ADMIN_ROLE) {
        supervisors[supervisor] = true;
    }

    /**
     * @notice Admins use this function to remove a supervisor
     * @param supervisor Supervisor's address
     */
    function removeSupervisor(address supervisor)
        external
        onlyRole(ADMIN_ROLE)
    {
        supervisors[supervisor] = false;
    }

    /**
     * @notice Admins use this function to set the seizedAssetsWallet wallet address
     * @param _seizedAssetsWallet A wallet address to transfer seized assets
     */
    function setSeizedAssetsWallet(address _seizedAssetsWallet)
        external
        onlyRole(ADMIN_ROLE)
    {
        seizedAssetsWallet = _seizedAssetsWallet;
    }

    function adminWithdraw(
        uint256 amount,
        address _to,
        address _tokenAddr
    ) public onlyRole(ADMIN_ROLE) {
        require(_to != address(0));
        if (_tokenAddr == address(0)) {
            payable(_to).transfer(amount);
        } else {
            IERC20(_tokenAddr).transfer(_to, amount);
        }
    }
}
