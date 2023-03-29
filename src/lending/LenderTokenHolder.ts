import {AccountUpdate, DeployArgs, method, Permissions, PrivateKey, SmartContract, UInt64} from "snarkyjs";

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
        amount: UInt64,
    ){
        //TODO Potentially everybody can call this method without checks

        // this.self.parent!.publicKey.assertEquals(this.address) //Only callable from self

        this.balance.subInPlace(amount)
        // this.self.body.mayUseToken = AccountUpdate.MayUseToken.ParentsOwnToken;

    }

}