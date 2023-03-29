import {
    AccountUpdate,
    Circuit,
    DeployArgs,
    Experimental,
    Field,
    Int64,
    MerkleTree,
    method,
    Permissions,
    PrivateKey,
    PublicKey,
    Signature,
    SmartContract,
    State,
    state,
    Struct,
    Types,
    UInt64, VerificationKey,
} from 'snarkyjs';
import { structArrayToFields } from '../utils';
import { LENDING_MERKLE_HEIGHT } from './model';

export class TokenUserEvent extends Struct({
    sender: PublicKey,
    receiver: PublicKey,
    amount: UInt64,
}) {}

export class LendableToken extends SmartContract {
    static INITIAL_MINT = 1000000000;

    @state(UInt64) totalAmountInCirculation = State<UInt64>();
    @state(Field) approvalRoot = State<Field>();

    events = {
        transfer: TokenUserEvent,
        approve: TokenUserEvent,
    };

    deployToken(
        args: DeployArgs,
        editPermission: Types.AuthRequired,
        tokenSymbol: string
    ) {
        super.deploy(args);

        this.account.tokenSymbol.set(tokenSymbol);

        this.account.permissions.set({
            ...Permissions.default(),
            editState: editPermission,
            setTokenSymbol: editPermission,
            send: editPermission,
            receive: editPermission,
            editSequenceState: editPermission,
        });

        let sender = this.sender;
        let amount = UInt64.from(LendableToken.INITIAL_MINT);

        Circuit.log('Minted to: ', sender);

        this.token.mint({
            address: sender,
            amount: amount,
        });

        this.emitEvent(
            'transfer',
            new TokenUserEvent({
                sender: PublicKey.empty(),
                receiver: sender,
                amount,
            })
        );
    }

    init(zkappKey?: PrivateKey) {
        super.init(zkappKey);

        this.approvalRoot.set(
            Circuit.witness(Field, () =>
                new MerkleTree(LENDING_MERKLE_HEIGHT).getRoot()
            )
        );
    }

    @method approveTransferCallback(
        callback: Experimental.Callback<any>,
        receiverAddress: PublicKey,
        amount: UInt64
    ) {
        const layout = AccountUpdate.Layout.AnyChildren;

        this.approve(callback, layout);

        this.token.mint({
            address: receiverAddress,
            amount: amount,
        });
    }

    //Copied from snarkyjs/examples/dex.ts
    @method approveUpdateAndSend(
        zkappUpdate: AccountUpdate,
        to: PublicKey,
        amount: UInt64
    ) {
        // TODO: THIS IS INSECURE. The proper version has a prover error (compile != prove) that must be fixed
        this.approve(zkappUpdate, AccountUpdate.Layout.AnyChildren);

        // THIS IS HOW IT SHOULD BE DONE:
        // // approve a layout of two grandchildren, both of which can't inherit the token permission
        // let { StaticChildren, AnyChildren } = AccountUpdate.Layout;
        // this.approve(zkappUpdate, StaticChildren(AnyChildren, AnyChildren));
        // zkappUpdate.body.mayUseToken.parentsOwnToken.assertTrue();
        // let [grandchild1, grandchild2] = zkappUpdate.children.accountUpdates;
        // grandchild1.body.mayUseToken.inheritFromParent.assertFalse();
        // grandchild2.body.mayUseToken.inheritFromParent.assertFalse();

        // see if balance change cancels the amount sent
        let balanceChange = Int64.fromObject(zkappUpdate.body.balanceChange);
        balanceChange.assertEquals(Int64.from(amount).neg());
        // add same amount of tokens to the receiving address
        this.token.mint({ address: to, amount });
    }

    @method getBalance(publicKey: PublicKey): UInt64 {
        let accountUpdate = AccountUpdate.create(publicKey, this.token.id);
        let balance = accountUpdate.account.balance.get();
        accountUpdate.account.balance.assertEquals(
            accountUpdate.account.balance.get()
        );
        return balance;
    }

    @method sendTokens(
        senderAddress: PublicKey,
        senderSignature: Signature,
        receiverAddress: PublicKey,
        amount: UInt64
    ) {
        senderSignature
            .verify(
                senderAddress,
                structArrayToFields(amount, receiverAddress, this.token.id)
            )
            .assertTrue('Signature not valid');

        this.token.send({
            from: senderAddress,
            to: receiverAddress,
            amount,
        });

        this.emitEvent(
            'transfer',
            new TokenUserEvent({
                sender: senderAddress,
                receiver: receiverAddress,
                amount,
            })
        );
    }

    private doDeployZkapp(address: PublicKey, proof: boolean) : AccountUpdate{
        let tokenId = this.token.id;
        let zkapp = AccountUpdate.create(address, tokenId);
        zkapp.account.permissions.set({
            ...Permissions.default(),
            editState: proof ? Permissions.proof() : Permissions.signature(),
            send: proof ? Permissions.proof() : Permissions.signature(),
            receive: Permissions.none(),
            incrementNonce: proof ? Permissions.proof() : Permissions.signature(),
            setTokenSymbol: Permissions.proofOrSignature()
        });
        return zkapp
    }

    @method deployZkapp(address: PublicKey, verificationKey: VerificationKey) {
        let zkapp = this.doDeployZkapp(address, true)
        zkapp.account.verificationKey.set(verificationKey);
        zkapp.requireSignature();
    }

    @method deployZkappSignature(address: PublicKey) {
        let zkapp = this.doDeployZkapp(address, false)
        zkapp.requireSignature();
    }

    /*
    @method approveTokens(
        senderAddress: PublicKey,
        senderSignature: Signature,
        receiverAddress: PublicKey,
        amount: UInt64,
        witness: LendingMerkleWitness,
        valueBefore: Field
    ) {
        let approvalRoot = this.approvalRoot.get();
        this.approvalRoot.assertEquals(approvalRoot);

        senderSignature
            .verify(
                senderAddress,
                structArrayToFields(amount, receiverAddress, this.token.id)
            )
            .assertTrue('Signature not valid');

        let approvalKey = Poseidon.hash(
            structArrayToFields(senderAddress, receiverAddress)
        );

        //We have to check here, altough it doesn't really matter for the business logic, otherwise any witness will be valid
        witness
            .calculateIndex()
            .assertEquals(approvalKey, 'Witness index not correct');
        witness
            .calculateRoot(valueBefore)
            .assertEquals(approvalRoot, 'Provided witness not correct');

        let newRoot = witness.calculateRoot(amount.value);

        this.approvalRoot.set(newRoot);

        this.emitEvent(
            'approve',
            new TokenUserEvent({
                sender: senderAddress,
                receiver: receiverAddress,
                amount,
            })
        );
    }*/

    /**
     * @param from
     * @param to
     * @param amount
     * @param witness
     * @param approvalAmount
     * @return Bool whether the requested amount has been transferred
     */
    /*@method transferFrom(
        from: PublicKey,
        to: PublicKey,
        amount: UInt64,
        witness: LendingMerkleWitness,
        approvalAmount: UInt64
    ): Bool {
        let approvalRoot = this.approvalRoot.get();
        this.approvalRoot.assertEquals(approvalRoot);

        let approvalKey = Poseidon.hash(structArrayToFields(from, to));

        witness
            .calculateIndex()
            .assertEquals(approvalKey, 'Witness index not correct');
        witness
            .calculateRoot(approvalAmount.value)
            .assertEquals(approvalRoot, 'Provided witness not correct');

        let amountCovered = approvalAmount.greaterThanOrEqual(amount);
        let amountTransferring = Circuit.if(amountCovered, amount, UInt64.from(0));

        let newRoot = witness.calculateRoot(
            approvalAmount.sub(amountTransferring).value
        );
        this.approvalRoot.set(newRoot);

        this.token.send({
            from,
            to,
            amount: amountTransferring,
        });

        this.emitEvent(
            'transfer',
            new TokenUserEvent({
                sender: from,
                receiver: to,
                amount: amountTransferring,
            })
        );

        return amountTransferring.equals(amount);
    }*/

    // @method mint(
    //     receiverAddress: PublicKey,
    //     amount: UInt64,
    //     adminSignature: Signature
    // ) {
    //     let totalAmountInCirculation = this.totalAmountInCirculation.get();
    //     this.totalAmountInCirculation.assertEquals(totalAmountInCirculation);
    //
    //     let newTotalAmountInCirculation = totalAmountInCirculation.add(amount);
    //
    //     adminSignature
    //         .verify(
    //             this.address,
    //             amount.toFields().concat(receiverAddress.toFields())
    //         )
    //         .assertTrue();
    //
    //     this.token.mint({
    //         address: receiverAddress,
    //         amount,
    //     });
    //
    //     this.totalAmountInCirculation.set(newTotalAmountInCirculation);
    // }
}
