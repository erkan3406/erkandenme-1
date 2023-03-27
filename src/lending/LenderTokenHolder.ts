import {AccountUpdate, Experimental, Field, method, PublicKey, SmartContract, State, state, UInt64} from "snarkyjs";
import {LendableToken} from "./LendableToken";

export class LenderTokenHolder extends SmartContract{

    // @state(Field) balanceRoot = State<Field>()

    // @method
    // addLiquidity(
    //     parentUpdate: AccountUpdate,
    //     tokenAddress: PublicKey,
    //     amount: UInt64
    // ) {
    //
    //
    //
    // }

    @method
    borrow(
        // approveCallback: Experimental.Callback<any>,
        // tokenAddress: PublicKey,
        // reciever: PublicKey,
        amount: UInt64,
    ){
        //TODO Potentially everybody can call this method without checks

        this.self.parent!.publicKey.assertEquals(this.address) //Only callable from self

        this.balance.subInPlace(amount)

        this.self.body.mayUseToken = AccountUpdate.MayUseToken.ParentsOwnToken;

        // let token = new LendableToken(tokenAddress)
        // token.token.id.assertEquals(this.self.tokenId)
        //
        // token.approveTransferCallback(approveCallback, reciever, amount)

    }

    /*
     * This method is used to get authorization from the token owner. Remember,
     * the token owner is the one who created the custom token. To debit their
     * balance, we must get authorization from the token owner
     */
    @method approveSend(amount: UInt64) {
        // this.tokenId
        //TODO Authorization
        this.balance.subInPlace(amount);
    }

}