# Contracts of the Muon Optimistic Network

The [Collateral Manager](contracts/CollateralManager.sol) is responsible for processing the following:

- Warrantor nodes `deposit` the assets they intend to lock partially for each request. Once the warranty period ends, the warrantor node can `unlock` its locked assets if there are no disputes in preparing for upcoming requests. It can also provide a list of `unlockables` to be unlocked simultaneously with the subsequent `lock` request.

```
deposit(address asset, uint256 amount)
withdraw(address asset, uint256 amount)
lock(
    address asset,
    uint256 amount,
    uint256 muonAppId,
    address user,
    bytes32 reqId,
    bytes32[] calldata unlockables
)
unlock(bytes32[] calldata unlockables)
```

- Contracts of dApps using the Muon Optimistic Network, check the placed `requests` with the collateral manager to confirm that enough assets have been locked for the warranty of the signed request.

```
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
```

- Supervisor nodes verify the data for which warrantor nodes have locked assets and place a `dispute` if they see inconsistencies. The dispute resolver, usually instantiated as a DAO, resolves potential disputes.

```
dispute(bytes32 reqId)
resolveDispute(bytes32 reqId, bool result)
```

- The admin is responsible for adding and removing supervisor nodes, modifying the warranty period, setting the wallet for seized funds and withdrawing deposited funds in emergency conditions.

```
addSupervisor(address supervisor)
removeSupervisor(address supervisor)
setWarrantyDuration(uint256 duration)
setSeizedAssetsWallet(address wallet)
adminWithdraw(uint256 amount, address dest, address token)
```

# Installation

To install and set up the Muon Optimistic, follow these steps:

1. Clone the repository:
   ```
   git clone https://github.com/siftal/muon-optimistic-contracts.git
   ```

2. Install the required dependencies:
   ```
   npm install
   ```

# Testing

To run the tests:

```
npx hardhat test
```

# Deployment

To deploy the Muon Optimistic Contracts to a specific network, ensure that the network settings are correctly configured in the deployment scripts. Then, run the deployment command:

```
npx hardhat run scripts/deploy.ts --network <network-name>
```
