import {
    Bool,
    Field,
    MerkleWitness,
    Poseidon,
    PublicKey,
    Struct,
    UInt64,
} from 'snarkyjs';
import {structArrayToFields} from '../utils';

export class Proposal extends Struct({
    amount: UInt64,
    receiver: PublicKey,
}) {
    hash(): Field {
        return Poseidon.hash(structArrayToFields(this.amount, this.receiver));
    }
}

export class SignerState extends Struct({
    pubkey: PublicKey,
    voted: Bool,
}) {
    hash(): Field {
        return Poseidon.hash(structArrayToFields(this.pubkey, this.voted));
    }
}

export class ProposalState extends Struct({
    proposal: Proposal,
    votes: [Field, Field],
    signerStateRoot: Field,
}) {
    hash() {
        return Poseidon.hash(
            structArrayToFields(
                new Proposal(this.proposal).hash(),
                ...this.votes,
                this.signerStateRoot
            )
        );
    }

    caBeNew(): Bool {
        return this.votes[0].equals(Field(0)).and(this.votes[1].equals(Field(0)));
    }

    deepCopy(): ProposalState {
        return new ProposalState({
            proposal: this.proposal,
            votes: [this.votes[0], this.votes[1]],
            signerStateRoot: this.signerStateRoot,
        });
    }
}

export const MULTISIG_MERKLE_HEIGHT = 255;

export class MultiSigMerkleWitness extends MerkleWitness(
    MULTISIG_MERKLE_HEIGHT
) {
}
