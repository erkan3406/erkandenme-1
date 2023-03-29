import {
    AccountUpdate,
    Circuit,
    DeployArgs,
    Field,
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
import { LendableToken } from './LendableToken';
import { structArrayToFields } from '../utils';
import {
    BorrowEvent,
    LendingMerkleWitness,
    LendingUserInfo,
    LiquidityAddEvent,
    UserLiquidityAction,
} from './model';
import { LiquidityActionWitnesses, WitnessService } from './WitnessService';
import {LenderTokenHolder} from "./LenderTokenHolder";

export const staticWitnessService = new WitnessService();

class LenderLiquidityReducerResult extends Struct({
    liquidityRoot: Field,
    totalCollateral: UInt64,
}) {}

/**
 * This contract is the main contract of the mock-lending protocol.
 * It holds all tokens in the system (liquidity which is not borrowed yet)
 *
 * Info:
 * Every token has price of 1
 */
export class Lender extends SmartContract {
    @state(Field) userLiquidityRoot = State<Field>();

    @state(UInt64) totalCollateral = State<UInt64>();

    @state(Field) latestActionHash = State<Field>();

    events = {
        'borrow': BorrowEvent,
        'liquidity-added': LiquidityAddEvent,
    };

    reducer = Reducer({ actionType: UserLiquidityAction });

    signature_prefixes = {
        borrow: Field(1001),
        repay: Field(1002),
    };

    //Reference to generate Witnesses, not part of circuit
    witnessService: WitnessService;

    static getInstance(
        address: PublicKey,
        witnessService: WitnessService
    ): Lender {
        Lender.analyzeMethods();
        let contract = new Lender(address);
        contract.witnessService = witnessService;
        return contract;
    }

    customDeploy(args: DeployArgs, proofsEnabled: boolean) {
        super.deploy(args);

        const editPermission = proofsEnabled ? Permissions.proof() : Permissions.signature();

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
        parentUpdate: AccountUpdate,
        tokenAddress: PublicKey,
        amount: UInt64
    ) {
        let sender = this.sender; //Save, so that only one witness is generated

        Circuit.log('addLiquidity sender:', sender);

        //TODO Move that logic into LenderTokenHolder
        // let tokenHolder = new LenderTokenHolder(this.address, tokenId)
        // tokenHolder.addLiquidity(parentUpdate, tokenAddress, amount)

        let token = new LendableToken(tokenAddress);
        token.approveUpdateAndSend(parentUpdate, this.address, amount);

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
                tokenId: token.token.id,
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
            (
                state: LenderLiquidityReducerResult,
                action: UserLiquidityAction
            ) => {
                Circuit.log('Action:', action.user);

                //Generate Witnesses
                let {
                    witnessToken,
                    witnessUser,
                    liquiditySoFar,
                    borrowed,
                    totalLiquidity,
                } = Circuit.witness(LiquidityActionWitnesses, () => {
                    return staticWitnessService.getWitnesses(action);
                });

                //Check transition
                witnessToken
                    .calculateIndex()
                    .assertEquals(
                        action.token.x,
                        'Token witness index not correct'
                    );
                let tokenRoot = witnessToken.calculateRoot(liquiditySoFar.value);

                let userInfo = new LendingUserInfo({
                    borrowed,
                    totalLiquidity,
                    liquidityRoot: tokenRoot,
                });

                witnessUser
                    .calculateIndex()
                    .assertEquals(
                        action.user.x,
                        'User witness index not correct'
                    );


                witnessUser
                    .calculateRoot(
                        userInfo.hash(WitnessService.emptyMerkleRoot)
                    )
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

                let newTotalCollateral = state.totalCollateral.add(
                    action.amount
                );

                return new LenderLiquidityReducerResult({
                    liquidityRoot: newRoot,
                    totalCollateral: newTotalCollateral,
                });
            },
            { state: reducerState, actionsHash: latestActionsHash },
            { maxTransactionsWithActions: 2 }
        );

        //Update latestActionHash and liqudityRoot
        this.userLiquidityRoot.set(reducerResult.state.liquidityRoot);
        this.totalCollateral.set(reducerResult.state.totalCollateral);
        this.latestActionHash.set(reducerResult.actionsHash);
    }


    @method
    borrow(
        tokenAddress: PublicKey,
        tokenId: Field,
        amount: UInt64,
        signature: Signature,
        witness: LendingMerkleWitness,
        _userInfo: LendingUserInfo
    ) {
        Circuit.log('borrow');

        let blockChainLength = this.network.blockchainLength.get();
        this.network.blockchainLength.assertBetween(
            blockChainLength,
            blockChainLength.add(10)
        ); //Only valid if included in the next 10 blocks

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
            .verify(
                sender,
                structArrayToFields(
                    this.signature_prefixes['borrow'],
                    tokenAddress,
                    amount.value
                )
            )
            .assertTrue('Signature not valid');

        witness
            .calculateIndex()
            .assertEquals(sender.x, 'Witness index not correct');

        witness
            .calculateRoot(userInfo.hash(WitnessService.emptyMerkleRoot))
            .assertEquals(liquidityRoot, 'Liquidity root not validated');

        userInfo.borrowed = userInfo.borrowed.add(amount);

        let tokenHolder = new LenderTokenHolder(this.address, tokenId)
        tokenHolder.borrow(
            amount
        )

        let token = new LendableToken(tokenAddress)
        token.approveUpdateAndSend(tokenHolder.self, sender, amount)

        let newLiquidityRoot = witness.calculateRoot(
            userInfo.hash(WitnessService.emptyMerkleRoot)
        );

        this.userLiquidityRoot.set(newLiquidityRoot);

        this.emitEvent(
            'borrow',
            new BorrowEvent({
                tokenId: tokenId,
                account: sender,
                amount,
            })
        );
    }
}
