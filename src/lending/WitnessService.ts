import { Field, MerkleTree, PublicKey, Struct, UInt64 } from 'snarkyjs';
import {
    LENDING_MERKLE_HEIGHT,
    LendingMerkleWitness,
    LendingUserInfo,
    UserLiquidityAction,
} from './model';

export class LiquidityActionWitnesses extends Struct({
    witnessUser: LendingMerkleWitness,
    witnessToken: LendingMerkleWitness,
    borrowed: UInt64,
    totalLiquidity: UInt64,
    liquiditySoFar: UInt64,
}) {}

export class WitnessService {
    userLiquidityMap = new MerkleTree(LENDING_MERKLE_HEIGHT);
    userTokenLiquidity: { [key: string]: MerkleTree } = {};

    //raw data
    userLiquidities: {
        [key: string]: {
            [key: string]: string;
            borrowed: string;
            totalLiquidity: string;
        };
    } = {};

    static emptyMerkleRoot = new MerkleTree(LENDING_MERKLE_HEIGHT).getRoot();

    initUser(pk: string) {
        this.userTokenLiquidity[pk] = new MerkleTree(LENDING_MERKLE_HEIGHT);
        this.userLiquidities[pk] = {
            borrowed: "0",
            totalLiquidity: "0",
        };
    }

    getWitnesses(action: UserLiquidityAction): LiquidityActionWitnesses {
        let userPk = action.user.toBase58();

        let witnessUser = new LendingMerkleWitness(
            this.userLiquidityMap.getWitness(action.user.x.toBigInt())
        );
        let tokenLiquidityTree =
            this.userTokenLiquidity[userPk] ??
            new MerkleTree(LENDING_MERKLE_HEIGHT); //In case the user doesn't exist, which happens if reducer calls when len(dispatched actions) < maxTransactionsWithActions
        let witnessToken = new LendingMerkleWitness(
            tokenLiquidityTree.getWitness(action.token.x.toBigInt())
        );
        let userInfo =
            this.userLiquidities[userPk] ??
            {
                borrowed: "0",
                totalLiquidity: "0",
            };
        let borrowed = UInt64.from(userInfo.borrowed);
        let totalLiquidity = UInt64.from(userInfo.totalLiquidity);
        let liquiditySoFar = UInt64.from(
            (userInfo[action.token.toBase58()] ?? "0")
        );

        let witnesses = new LiquidityActionWitnesses({
            witnessToken,
            witnessUser,
            borrowed,
            totalLiquidity,
            liquiditySoFar,
        });

        if (action.amount.toBigInt() > 0n) {
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
            userInfo.totalLiquidity = UInt64.from(userInfo.totalLiquidity).add(
                action.amount
            ).toString();
        }

        return witnesses;
    }

    getBorrowWitness(
        user: PublicKey,
        amount: UInt64
    ): [LendingMerkleWitness, LendingUserInfo] {
        let w = this.userLiquidityMap.getWitness(user.x.toBigInt());
        let userLiquidity = this.userLiquidities[user.toBase58()];
        let userInfo: LendingUserInfo = new LendingUserInfo({
            borrowed: UInt64.from(userLiquidity.borrowed.toString()),
            totalLiquidity: UInt64.from(
                userLiquidity.totalLiquidity.toString()
            ),
            liquidityRoot: Field(
                this.userTokenLiquidity[user.toBase58()].getRoot().toString()
            ),
        });

        //Changes
        userLiquidity.borrowed = UInt64.from(userLiquidity.borrowed).add(amount).toString();
        this.userLiquidityMap.setLeaf(
            user.x.toBigInt(),
            new LendingUserInfo({
                borrowed: UInt64.from(userLiquidity.borrowed),
                totalLiquidity: UInt64.from(userLiquidity.totalLiquidity),
                liquidityRoot: this.userTokenLiquidity[user.toBase58()].getRoot(),
            }).hash(WitnessService.emptyMerkleRoot)
        );

        return [new LendingMerkleWitness(w), userInfo];
    }
}
