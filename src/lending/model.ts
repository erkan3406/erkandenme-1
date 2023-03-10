import {
  Circuit,
  Field,
  MerkleMapWitness,
  MerkleTree,
  MerkleWitness,
  Poseidon,
  PublicKey,
  Struct,
  UInt64,
} from 'snarkyjs';
import { structArrayToFields } from '../utils';
//
// export class TokenStats extends Struct({
//
//     key: PublicKey,
//     totalAmount: UInt64,
//     amountLentOut: UInt64,
//     price: UInt64
//
// }){}

export class LendingUserInfo extends Struct({
  liquidityRoot: Field, //TokenPK => Field
  borrowed: UInt64,
  totalLiquidity: UInt64,
}) {
  hash(emptyMerkleTree: Field): Field {
    let hash = Poseidon.hash(
      structArrayToFields(this.borrowed, this.liquidityRoot)
    );
    return Circuit.if(
      this.borrowed
        .equals(UInt64.zero)
        .and(this.liquidityRoot.equals(emptyMerkleTree)),
      Field(0),
      hash
    );
  }
}

export class LiquidityAddEvent extends Struct({
  token: PublicKey,
  account: PublicKey,
  amount: UInt64,
}) {}

export class BorrowEvent extends Struct({
  token: PublicKey,
  account: PublicKey,
  amount: UInt64,
}) {}

export class UserLiquidityAction extends Struct({
  user: PublicKey,
  token: PublicKey,
  amount: UInt64,
}) {}

export const LENDING_MERKLE_HEIGHT = 255; //10

export class LendingMerkleWitness extends MerkleWitness(
  LENDING_MERKLE_HEIGHT
) {}

export class ValuedMerkleTreeWitness extends Struct({
  value: Field,
  witness: LendingMerkleWitness,
}) {}
