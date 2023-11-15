import { ethers, upgrades } from "hardhat";
import { Signer, BigNumber, constants } from "ethers";
import { expect } from "chai";

import { CollateralManager } from "../typechain/CollateralManager";
import { IERC20 } from "../typechain/IERC20";

describe("CollateralManager", function () {
  let owner: Signer;
  let warrantor: Signer;
  let supervisor: Signer;
  let user: Signer;
  let disputeResolver: Signer;
  let seizedAssetsWallet: Signer;
  let token: IERC20;
  let collateralManager: CollateralManager;

  const muonAppId = "108368118723198544735396482429184685038942687720309538608401626615048580010686";

  const ZERO_ADDRESS = constants.AddressZero;
  const ONE_ETH = ethers.utils.parseEther("1");

  beforeEach(async function () {
    [
      owner,
      warrantor,
      supervisor,
      user,
      disputeResolver,
      seizedAssetsWallet,
    ] = await ethers.getSigners();

    const ERC20 = await ethers.getContractFactory("WrappedEth");
    token = await ERC20.connect(warrantor).deploy();
    await token.deployed();

    const CollateralManager = await ethers.getContractFactory(
      "CollateralManager"
    );
    collateralManager = await upgrades.deployProxy(CollateralManager, [
      seizedAssetsWallet.address,
    ]);
    await collateralManager.deployed();

    await collateralManager.grantRole(
      await collateralManager.DISPUTE_RESOLVER(),
      disputeResolver.address
    );

    await collateralManager.addSupervisor(supervisor.address);

    // deposit some tokens to the collateralManager contract
    await token.connect(warrantor).approve(collateralManager.address, ONE_ETH);
    await collateralManager.connect(warrantor).deposit(token.address, ONE_ETH);
  });

  describe("lock", function () {
    it("should lock collateral for a request", async function () {
      const amount = ONE_ETH.div(2);
      const reqId = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes("test request")
      );
      const unlockables = [];
      await collateralManager
        .connect(warrantor)
        .lock(
          token.address,
          amount,
          muonAppId,
          user.address,
          reqId,
          unlockables
        );

      // check that the collateral was locked
      const request = await collateralManager.requests(reqId);
      expect(request.warrantor).to.equal(warrantor.address);
      expect(request.asset).to.equal(token.address);
      expect(request.amount).to.equal(amount);
      expect(request.muonAppId).to.equal(muonAppId);
      expect(request.user).to.equal(user.address);
      expect(request.time).to.be.closeTo(
        (await ethers.provider.getBlock()).timestamp,
        1
      );
      expect(request.status).to.equal(1); // RequestStatus.LOCKED
      expect(request.claimer).to.equal(ZERO_ADDRESS);

      // check that the warrantor's balance was updated
      expect(
        await collateralManager.balances(token.address, warrantor.address)
      ).to.equal(ONE_ETH.sub(amount));

      const lockedEvent = (
        await collateralManager.queryFilter(
          collateralManager.filters.Locked(null, null, null, null, null, reqId)
        )
      )[0];
      expect(lockedEvent.args.warrantor).to.equal(warrantor.address);
      expect(lockedEvent.args.asset).to.equal(token.address);
      expect(lockedEvent.args.amount).to.equal(amount);
      expect(lockedEvent.args.muonAppId).to.equal(muonAppId);
      expect(lockedEvent.args.user).to.equal(user.address);
    });
  });

  describe("unlock", function () {
    it("should unlock expired requests", async function () {
      const amount = ONE_ETH.div(2);
      const reqId = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes("test request")
      );
      const unlockables = [];
      await collateralManager
        .connect(warrantor)
        .lock(
          token.address,
          amount,
          muonAppId,
          user.address,
          reqId,
          unlockables
        );

      const warrantyDuration = (
        await collateralManager.warrantyDuration()
      ).toNumber();
      await ethers.provider.send("evm_increaseTime", [warrantyDuration]);
      await ethers.provider.send("evm_mine", []);

      // unlock expired requests
      await collateralManager.unlock([reqId]);
      const request = await collateralManager.requests(reqId);
      expect(request.status).to.equal(2); // RequestStatus.UNLOCKED
      expect(
        await collateralManager.balances(token.address, warrantor.address)
      ).to.equal(ONE_ETH);

      const unlockedEvent = (
        await collateralManager.queryFilter(
          collateralManager.filters.Unlocked(
            null,
            null,
            null,
            null,
            null,
            reqId
          )
        )
      )[0];
      expect(unlockedEvent.args.warrantor).to.equal(warrantor.address);
      expect(unlockedEvent.args.asset).to.equal(token.address);
      expect(unlockedEvent.args.amount).to.equal(amount);
      expect(unlockedEvent.args.muonAppId).to.equal(muonAppId);
      expect(unlockedEvent.args.user).to.equal(user.address);
    });

    it("should not unlock non-expired requests", async function () {
      const amount = ONE_ETH.div(2);
      const reqId = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes("test request")
      );
      const unlockables = [];
      await collateralManager
        .connect(warrantor)
        .lock(
          token.address,
          amount,
          muonAppId,
          user.address,
          reqId,
          unlockables
        );

      // try to unlock the request and check that it fails
      await collateralManager.unlock([reqId]);
      const request = await collateralManager.requests(reqId);
      expect(request.status).to.equal(1); // RequestStatus.LOCKED
      expect(
        await collateralManager.balances(token.address, warrantor.address)
      ).to.equal(ONE_ETH.sub(amount));
    });

    it("should unlock disputed requests if the dispute is rejected and expired", async function () {
      const amount = ONE_ETH.div(2);
      const reqId = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes("test request")
      );
      const unlockables = [];
      await collateralManager
        .connect(warrantor)
        .lock(
          token.address,
          amount,
          muonAppId,
          user.address,
          reqId,
          unlockables
        );

      await collateralManager.connect(supervisor).dispute(reqId);

      // try to unlock the request and check that it fails
      await collateralManager.unlock([reqId]);
      let request = await collateralManager.requests(reqId);
      expect(request.status).to.equal(3); // RequestStatus.DISPUTED
      expect(
        await collateralManager.balances(token.address, warrantor.address)
      ).to.equal(ONE_ETH.sub(amount));

      // reject the dispute
      await collateralManager
        .connect(disputeResolver)
        .resolveDispute(reqId, false);
      request = await collateralManager.requests(reqId);
      expect(request.status).to.equal(5); // RequestStatus.DISPUTE_REJECTED

      // try to unlock the request and check that it fails
      await collateralManager.unlock([reqId]);
      request = await collateralManager.requests(reqId);
      expect(request.status).to.equal(5); // RequestStatus.DISPUTE_REJECTED
      expect(
        await collateralManager.balances(token.address, warrantor.address)
      ).to.equal(ONE_ETH.sub(amount));

      // after the request expired can unlock the collateral
      const warrantyDuration = (
        await collateralManager.warrantyDuration()
      ).toNumber();
      await ethers.provider.send("evm_increaseTime", [warrantyDuration]);
      await ethers.provider.send("evm_mine", []);

      await collateralManager.unlock([reqId]);
      request = await collateralManager.requests(reqId);
      expect(request.status).to.equal(2); // RequestStatus.UNLOCKED
      expect(
        await collateralManager.balances(token.address, warrantor.address)
      ).to.equal(ONE_ETH);
    });

    it("should not unlock disputed requests if the dispute is confirmed", async function () {
      const amount = ONE_ETH.div(2);
      const reqId = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes("test request")
      );
      const unlockables = [];
      await collateralManager
        .connect(warrantor)
        .lock(
          token.address,
          amount,
          muonAppId,
          user.address,
          reqId,
          unlockables
        );

      // initiate a dispute
      await collateralManager.connect(supervisor).dispute(reqId);

      // confirm the dispute
      await collateralManager
        .connect(disputeResolver)
        .resolveDispute(reqId, true);
      let request = await collateralManager.requests(reqId);
      expect(request.status).to.equal(4); // RequestStatus.DISPUTE_CONFIRMED
      // after confirming the dispute, the collateral will transfer to the seized Wallet
      expect(await token.balanceOf(await seizedAssetsWallet.address)).to.equal(
        amount
      );

      // after confirming the dispute, the collateral cannot be unlocked
      const warrantyDuration = (
        await collateralManager.warrantyDuration()
      ).toNumber();
      await ethers.provider.send("evm_increaseTime", [warrantyDuration]);
      await ethers.provider.send("evm_mine", []);
      await collateralManager.unlock([reqId]);
      request = await collateralManager.requests(reqId);
      expect(request.status).to.equal(4); // RequestStatus.DISPUTE_CONFIRMED
      expect(
        await collateralManager.balances(token.address, warrantor.address)
      ).to.equal(ONE_ETH.sub(amount));
    });
  });

  describe("dispute", function () {
    it("should initiate a dispute by a supervisor", async function () {
      const amount = ONE_ETH.div(2);
      const reqId = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes("test request")
      );
      const unlockables = [];
      await collateralManager
        .connect(warrantor)
        .lock(
          token.address,
          amount,
          muonAppId,
          user.address,
          reqId,
          unlockables
        );

      // initiate a dispute
      await collateralManager.connect(supervisor).dispute(reqId);
      const request = await collateralManager.requests(reqId);
      expect(request.status).to.equal(3); // RequestStatus.DISPUTED
      expect(request.claimer).to.equal(supervisor.address);

      // try to initiate a dispute for a non-locked request and check that it fails
      await expect(
        collateralManager.connect(supervisor).dispute(reqId)
      ).to.be.revertedWith("request is not locked");
    });

    it("should not initiate a dispute by a non-supervisor", async function () {
      const amount = ONE_ETH.div(2);
      const reqId = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes("test request")
      );
      const unlockables = [];
      await collateralManager
        .connect(warrantor)
        .lock(
          token.address,
          amount,
          muonAppId,
          user.address,
          reqId,
          unlockables
        );

      // try to initiate a dispute by a non-supervisor and check that it fails
      await expect(
        collateralManager.connect(owner).dispute(reqId)
      ).to.be.revertedWith("only supervisors can dispute");
      const request = await collateralManager.requests(reqId);
      expect(request.status).to.equal(1); // RequestStatus.LOCKED
      expect(request.claimer).to.equal(ethers.constants.AddressZero);
    });

    it("should not initiate a dispute for a non-locked request", async function () {
      const reqId = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes("test request")
      );

      // try to initiate a dispute for a non-locked request and check that it fails
      await expect(
        collateralManager.connect(supervisor).dispute(reqId)
      ).to.be.revertedWith("request is not locked");
      const request = await collateralManager.requests(reqId);
      expect(request.status).to.equal(0); // RequestStatus.UNINITIALIZED
      expect(request.claimer).to.equal(ethers.constants.AddressZero);
    });
  });

  describe("resolveDispute", function () {
    it("should submit the result of the dispute", async function () {
      const amount = ONE_ETH.div(2);
      const reqId = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes("test request")
      );
      const unlockables = [];
      await collateralManager
        .connect(warrantor)
        .lock(
          token.address,
          amount,
          muonAppId,
          user.address,
          reqId,
          unlockables
        );

      // initiate a dispute
      await collateralManager.connect(supervisor).dispute(reqId);

      // submit the result of the dispute
      await collateralManager
        .connect(disputeResolver)
        .resolveDispute(reqId, false);

      // check that the request status was updated
      let request = await collateralManager.requests(reqId);
      expect(request.status).to.equal(5); // RequestStatus.DISPUTE_REJECTED

      const warrantyDuration = (
        await collateralManager.warrantyDuration()
      ).toNumber();
      await ethers.provider.send("evm_increaseTime", [warrantyDuration]);
      await ethers.provider.send("evm_mine", []);

      // unlock expired requests
      await collateralManager.unlock([reqId]);
      request = await collateralManager.requests(reqId);
      expect(request.status).to.equal(2); // RequestStatus.UNLOCKED
      expect(
        await collateralManager.balances(token.address, warrantor.address)
      ).to.equal(ONE_ETH);

      // check that the asset was not transferred to the seized assets wallet
      expect(await token.balanceOf(seizedAssetsWallet.address)).to.equal(0);

      // submit the result of another dispute and check that the asset was transferred to the seized assets wallet
      const amount2 = ONE_ETH;
      const reqId2 = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes("test request 2")
      );
      await collateralManager
        .connect(warrantor)
        .lock(
          token.address,
          amount2,
          muonAppId,
          user.address,
          reqId2,
          unlockables
        );

      await collateralManager.connect(supervisor).dispute(reqId2);
      await collateralManager
        .connect(disputeResolver)
        .resolveDispute(reqId2, true);

      // check that the request status was updated
      const request2 = await collateralManager.requests(reqId2);
      expect(request2.status).to.equal(4); // RequestStatus.DISPUTE_CONFIRMED
      expect(await token.balanceOf(seizedAssetsWallet.address)).to.equal(
        amount2
      );
    });

    it("should not submit the result of a non-disputed request", async function () {
      const amount = ONE_ETH.div(2);
      const reqId = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes("test request")
      );
      const unlockables = [];
      await collateralManager
        .connect(warrantor)
        .lock(
          token.address,
          amount,
          muonAppId,
          user.address,
          reqId,
          unlockables
        );

      // try to submit the result of a non-disputed request and check that it fails
      await expect(
        collateralManager.connect(disputeResolver).resolveDispute(reqId, false)
      ).to.be.revertedWith("not disputed");
      const request = await collateralManager.requests(reqId);
      expect(request.status).to.equal(1); // RequestStatus.LOCKED
      expect(await token.balanceOf(seizedAssetsWallet.address)).to.equal(0);
    });
  });

  describe("deposit", function () {
    it("should deposit the collateral token", async function () {
      const amount = ONE_ETH;
      await token.connect(warrantor).approve(collateralManager.address, amount);
      await collateralManager.connect(warrantor).deposit(token.address, amount);
      expect(
        await collateralManager.balances(token.address, warrantor.address)
      ).to.equal(amount.mul(2));
      const depositEvent = (
        await collateralManager.queryFilter(
          collateralManager.filters.Deposited(null, token.address, null)
        )
      )[0];
      expect(depositEvent.args.warrantor).to.equal(warrantor.address);
      expect(depositEvent.args.asset).to.equal(token.address);
      expect(depositEvent.args.amount).to.equal(amount);
    });
  });

  describe("withdraw", function () {
    it("should withdraw the collateral token", async function () {
      const balanceBefore = await token.balanceOf(warrantor.address);
      // deposit
      await token
        .connect(warrantor)
        .approve(collateralManager.address, ONE_ETH);
      await collateralManager
        .connect(warrantor)
        .deposit(token.address, ONE_ETH);
      expect(
        await collateralManager.balances(token.address, warrantor.address)
      ).to.equal(ONE_ETH.mul(2));

      // withdraw
      await collateralManager
        .connect(warrantor)
        .withdraw(token.address, ONE_ETH);
      // check that the warrantor's balance was updated
      expect(await token.balanceOf(warrantor.address)).to.equal(balanceBefore);
      expect(
        await collateralManager.balances(token.address, warrantor.address)
      ).to.equal(ONE_ETH);
    });

    it("should not withdraw the collateral token if the balance is not enough", async function () {
      const amount = ONE_ETH.div(2);
      const reqId = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes("test request")
      );
      const unlockables = [];
      await collateralManager
        .connect(warrantor)
        .lock(
          token.address,
          amount,
          muonAppId,
          user.address,
          reqId,
          unlockables
        );

      // try to withdraw the collateral token
      await expect(
        collateralManager.connect(warrantor).withdraw(token.address, ONE_ETH)
      ).to.be.revertedWith("not enough balance");
    });
  });
});
