import {
    AccountUpdate,
    Circuit,
    DeployArgs, Experimental,
    Field,
    MerkleTree,
    method,
    Permissions,
    PrivateKey,
    PublicKey,
    Reducer,
    Signature,
    SmartContract,
    State,
    state,
    Struct,
    UInt64,
} from 'snarkyjs';
import {LendableToken} from './LendableToken';
import {structArrayToFields} from '../utils';
import {
    BorrowEvent,
    LENDING_MERKLE_HEIGHT,
    LendingMerkleWitness,
    LendingUserInfo,
    LiquidityAddEvent,
    UserLiquidityAction,
    ValuedMerkleTreeWitness,
} from './model';

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

export const staticWitnessService = new WitnessService();

class LenderLiquidityReducerResult extends Struct({
    liquidityRoot: Field,
    totalCollateral: UInt64,
}) {
}

//Info:
//Every token has price of 1
/*

    This contract is the main contract of the mock-lending protocol.
    It holds all tokens in the system (liquidity which is not borrowed yet)
 */
export class Lender extends SmartContract {
    @state(Field) userLiquidityRoot = State<Field>();
    // @state(Field) tokenLiquidityRoot = State<Field>()
    @state(UInt64) totalCollateral = State<UInt64>();

    @state(Field) latestActionHash = State<Field>();

    events = {
        'liquidity-added': LiquidityAddEvent,
        borrow: BorrowEvent,
    };

    reducer = Reducer({ actionType: UserLiquidityAction });
    // reducer = Reducer({ actionType: Field });

    signature_prefixes = {
        borrow: Field(1001),
        repay: Field(1002),
    };

    //Reference to generate Witnesses
    witnessService: WitnessService;

    static getInstance(
        address: PublicKey,
        witnessService: WitnessService
    ): Lender {
        Lender.analyzeMethods()
        let contract = new Lender(address);
        contract.witnessService = witnessService;
        return contract;
    }

    deploy(args: DeployArgs) {
        super.deploy(args);

        const editPermission = Permissions.proofOrSignature();

        this.account.permissions.set({
            ...Permissions.default(),
            editState: editPermission,
            setTokenSymbol: editPermission,
            send: editPermission,
            receive: editPermission,
            editSequenceState: editPermission,
        });
    }

    init(zkappKey?: PrivateKey) {
        super.init(zkappKey);

        this.latestActionHash.set(Reducer.initialActionsHash);
        this.userLiquidityRoot.set(WitnessService.emptyMerkleRoot);
    }

    @method
    addLiquidity(
        tokenAddress: PublicKey,
        amount: UInt64,
        approvalWitness: ValuedMerkleTreeWitness
        // liquidityWitness: ValuedMerkleMapWitness,
        // tokenLiquidityWitness: MerkleMapWitness,
        // currentTokenLiquidity: Field
    ) {
        // let liquidityRoot = this.userLiquidityRoot.get()
        // this.userLiquidityRoot.assertEquals(liquidityRoot)

        let sender = this.sender; //So that only one witness is generated

        Circuit.log("addLiquidity sender:", sender)

        let token = new LendableToken(tokenAddress);
        let success = token.transferFrom(
            sender,
            this.address,
            amount,
            approvalWitness.witness,
            UInt64.from(approvalWitness.value)
        );
        success.assertTrue('transferFrom not successful');

        //TODO Lock tokens?

        this.reducer.dispatch(
            new UserLiquidityAction({
                token: tokenAddress,
                user: sender,
                amount: amount,
            })
        );

        this.emitEvent(
            'liquidity-added',
            new LiquidityAddEvent({
                token: tokenAddress,
                amount: amount,
                account: sender,
            })
        );
    }

    @method
    rollupLiquidity() {

        let latestActionsHash = this.latestActionHash.get();
        this.latestActionHash.assertEquals(latestActionsHash);

        let liquidityRoot = this.userLiquidityRoot.get();
        this.userLiquidityRoot.assertEquals(liquidityRoot);

        let totalCollateral = this.totalCollateral.get();
        this.totalCollateral.assertEquals(totalCollateral);

        let actions = this.reducer.getActions({
            fromActionHash: latestActionsHash,
        });

        let reducerState = new LenderLiquidityReducerResult({
            liquidityRoot: liquidityRoot,
            totalCollateral: totalCollateral,
        });

        let reducerResult = this.reducer.reduce(
            actions,
            LenderLiquidityReducerResult,
            (state: LenderLiquidityReducerResult, action: UserLiquidityAction) => {
                Circuit.log('Action:', action.user);

                //Generate Witnesses
                let {
                    witnessToken,
                    witnessUser,
                    liquiditySoFar,
                    borrowed,
                    totalLiquidity,
                } = Circuit.witness(LiquidityActionWitnesses, () => {
                    console.log("Invoke 1")
                    return staticWitnessService.getWitnesses(action);
                });

                //Check transition
                witnessToken
                    .calculateIndex()
                    .assertEquals(action.token.x, 'Token witness index not correct');
                let tokenRoot = witnessToken.calculateRoot(liquiditySoFar.value);

                let userInfo = new LendingUserInfo({
                    borrowed,
                    totalLiquidity,
                    liquidityRoot: tokenRoot,
                });

                witnessUser
                    .calculateIndex()
                    .assertEquals(action.user.x, 'User witness index not correct');

                Circuit.log('Checkpoint 1B', WitnessService.emptyMerkleRoot);
                witnessUser
                    .calculateRoot(userInfo.hash(WitnessService.emptyMerkleRoot))
                    .assertEquals(
                        state.liquidityRoot,
                        'Liquidity membership check not successful'
                    );

                //Calculate new root
                userInfo.liquidityRoot = witnessToken.calculateRoot(
                    liquiditySoFar.add(action.amount).value
                );

                let newRoot = witnessUser.calculateRoot(
                    userInfo.hash(WitnessService.emptyMerkleRoot)
                );

                let newTotalCollateral = state.totalCollateral.add(action.amount);

                return new LenderLiquidityReducerResult({
                    liquidityRoot: newRoot,
                    totalCollateral: newTotalCollateral,
                });
            },
            {state: reducerState, actionsHash: latestActionsHash},
            {maxTransactionsWithActions: 2}
        );

        //Update latestActionHash and liqudityRoot
        this.userLiquidityRoot.set(reducerResult.state.liquidityRoot);
        this.totalCollateral.set(reducerResult.state.totalCollateral);
        this.latestActionHash.set(reducerResult.actionsHash);
    }

    @method
    borrow(
        tokenAddress: PublicKey,
        amount: UInt64,
        signature: Signature,
        witness: LendingMerkleWitness,
        _userInfo: LendingUserInfo
    ) {
        let blockChainLength = this.network.blockchainLength.get();
        //TODO Check if this is okay, since it might not get included and then CI fails
        this.network.blockchainLength.assertBetween(
            blockChainLength,
            blockChainLength.add(2)
        ); //Only valid if included in the next block

        this.network.timestamp.assertBetween(
            this.network.timestamp.get(),
            UInt64.MAXINT()
        );

        this.network.totalCurrency.assertBetween(
            UInt64.zero,
            this.network.totalCurrency.get().mul(2)
        );

        //TODO More preconditions

        let sender = this.sender;

        let liquidityRoot = this.userLiquidityRoot.get();
        this.userLiquidityRoot.assertEquals(liquidityRoot);

        let userInfo = new LendingUserInfo({
            borrowed: _userInfo.borrowed,
            totalLiquidity: _userInfo.totalLiquidity,
            liquidityRoot: _userInfo.liquidityRoot,
        });

        userInfo.totalLiquidity
            .sub(userInfo.borrowed)
            .assertGreaterThanOrEqual(
                amount,
                'Amount greater than remaining liquidity'
            );

        signature
            .verify(sender,
                structArrayToFields(
                    this.signature_prefixes['borrow'],
                    tokenAddress,
                    amount.value
                )
            ).assertTrue('Signature not valid');

        witness
            .calculateIndex()
            .assertEquals(sender.x, 'Witness index not correct');

        witness
            .calculateRoot(userInfo.hash(WitnessService.emptyMerkleRoot))
            .assertEquals(liquidityRoot, 'Liquidity root not validated');

        userInfo.borrowed = userInfo.borrowed.add(amount);

        let token = new LendableToken(tokenAddress);

        let au = Experimental.createChildAccountUpdate(this.self, this.address, token.token.id)
        au.balance.subInPlace(amount)

        token.approveUpdateAndSend(au, sender, amount);

        let newLiquidityRoot = witness.calculateRoot(
            userInfo.hash(WitnessService.emptyMerkleRoot)
        );

        this.userLiquidityRoot.set(newLiquidityRoot);

        this.emitEvent(
            'borrow',
            new BorrowEvent({
                token: tokenAddress,
                account: sender,
                amount,
            })
        );
    }
}
