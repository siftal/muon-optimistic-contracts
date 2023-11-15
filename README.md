Contracts of the Muon Optimistic Network.

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
