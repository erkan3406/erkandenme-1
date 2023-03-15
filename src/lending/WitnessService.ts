import {MerkleTree, PublicKey, Struct, UInt64} from "snarkyjs";
import {LENDING_MERKLE_HEIGHT, LendingMerkleWitness, LendingUserInfo, UserLiquidityAction} from "./model";

export class LiquidityActionWitnesses extends Struct({
    witnessUser: LendingMerkleWitness,
    witnessToken: LendingMerkleWitness,
    borrowed: UInt64,
    totalLiquidity: UInt64,
    liquiditySoFar: UInt64,
}) {
}

export class WitnessService {
    userLiquidityMap = new MerkleTree(LENDING_MERKLE_HEIGHT);
    userTokenLiquidity: { [key: string]: MerkleTree } = {};

    //raw data
    userLiquidities: {
        [key: string]: {
            [key: string]: UInt64;
            borrowed: UInt64;
            totalLiquidity: UInt64;
        };
    } = {};

    static emptyMerkleRoot = new MerkleTree(LENDING_MERKLE_HEIGHT).getRoot();

    initUser(pk: string) {
        this.userTokenLiquidity[pk] = new MerkleTree(LENDING_MERKLE_HEIGHT);
        this.userLiquidities[pk] = {
            borrowed: UInt64.zero,
            totalLiquidity: UInt64.zero,
        };
    }

    getWitnesses(action: UserLiquidityAction): LiquidityActionWitnesses {

        let userPk = action.user.toBase58();

        let witnessUser = new LendingMerkleWitness(
            this.userLiquidityMap.getWitness(action.user.x.toBigInt())
        );
        let tokenLiquidityTree = this.userTokenLiquidity[userPk] ?? new MerkleTree(LENDING_MERKLE_HEIGHT) //In case the user doesn't exist, which happens if reducer calls when len(dispatched actions) < maxTransactionsWithActions
        let witnessToken = new LendingMerkleWitness(
            tokenLiquidityTree.getWitness(action.token.x.toBigInt())
        );
        let userInfo = this.userLiquidities[userPk] ?? new LendingUserInfo({borrowed: UInt64.zero, totalLiquidity: UInt64.zero, liquidityRoot: WitnessService.emptyMerkleRoot});
        let borrowed = userInfo.borrowed;
        let totalLiquidity = userInfo.totalLiquidity;
        let liquiditySoFar = userInfo[action.token.toBase58()] ?? UInt64.zero;

        let witnesses = new LiquidityActionWitnesses({
            witnessToken,
            witnessUser,
            borrowed,
            totalLiquidity,
            liquiditySoFar,
        });

        if(action.amount.toBigInt() > 0n) {
            //Make change
            this.userTokenLiquidity[userPk].setLeaf(
                action.token.x.toBigInt(),
                liquiditySoFar.add(action.amount).value
            );
            let result = new LendingUserInfo({
                borrowed,
                totalLiquidity,
                liquidityRoot: this.userTokenLiquidity[userPk].getRoot(),
            });

            this.userLiquidityMap.setLeaf(
                action.user.x.toBigInt(),
                result.hash(WitnessService.emptyMerkleRoot)
            );
            userInfo.totalLiquidity = userInfo.totalLiquidity.add(action.amount)

        }

        return witnesses;
    }

    getBorrowWitness(user: PublicKey, amount: UInt64) : [LendingMerkleWitness, LendingUserInfo] {

        let w = this.userLiquidityMap.getWitness(user.x.toBigInt())
        let userLiquidity = this.userLiquidities[user.toBase58()]
        let userInfo = new LendingUserInfo({
            borrowed: userLiquidity.borrowed,
            totalLiquidity: userLiquidity.totalLiquidity,
            liquidityRoot: this.userTokenLiquidity[user.toBase58()].getRoot()
        })

        //Changes
        userLiquidity.borrowed = userLiquidity.borrowed.add(amount)
        this.userLiquidityMap.setLeaf(user.x.toBigInt(), new LendingUserInfo({
            borrowed: userLiquidity.borrowed,
            totalLiquidity: userLiquidity.totalLiquidity,
            liquidityRoot: this.userTokenLiquidity[user.toBase58()].getRoot(),
        }).hash(WitnessService.emptyMerkleRoot))

        return [new LendingMerkleWitness(w), userInfo]

    }
}