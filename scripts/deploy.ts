import { ethers, upgrades } from "hardhat";
import { CollateralManager } from "../typechain";

async function main() {
  const seizedAssetsWallet = "";
  const CollateralManager = await ethers.getContractFactory("CollateralManager");
  const collateralManager = await upgrades.deployProxy(
    CollateralManager,
    [seizedAssetsWallet],
    {
      initializer: "initialize",
    },
  );
  await collateralManager.deployed();
  console.log("CollateralManager deployed to:", collateralManager.address);

  await hre.run("verify:verify", {
    address: collateralManager.address,
    contract: "contracts/CollateralManager.sol:CollateralManager",
    constructorArguments: [],
  });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
