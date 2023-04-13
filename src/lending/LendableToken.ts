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
        tokenSymbol: string
    ) {
        super.deploy(args);

        this.account.tokenSymbol.set(tokenSymbol);

        this.account.permissions.set({
            ...Permissions.default(),
            editState: Permissions.proof(),
            setTokenSymbol: Permissions.proof(),
            send: Permissions.proof(),
            receive: Permissions.proof(),
            editActionState: Permissions.proof(),
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

    // @method approveTransferCallback(
    //     callback: Experimental.Callback<any>,
    //     receiverAddress: PublicKey,
    //     amount: UInt64
    // ) {
    //     const layout = AccountUpdate.Layout.AnyChildren;
    //
    //     this.approve(callback, layout);
    //
    //     this.token.mint({
    //         address: receiverAddress,
    //         amount: amount,
    //     });
    // }

    //Copied from snarkyjs/examples/dex.ts
    @method approveUpdateAndSend(
        zkappUpdate: AccountUpdate,
        to: PublicKey,
        amount: UInt64
    ) {
        // TODO: THIS IS INSECURE. The proper version has a prover error (compile != prove) that must be fixed
        this.approve(zkappUpdate, AccountUpdate.Layout.NoChildren);

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
        let zkapp = AccountUpdate.create(address, tokenId); //Gets approved automatically
        zkapp.account.permissions.set({
            ...Permissions.default(),
            editState: Permissions.proof(),
            send: Permissions.proof(),
            receive: Permissions.none(),
            incrementNonce: Permissions.proof(),
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

}
