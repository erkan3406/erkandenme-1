import {
  Bool,
  Circuit,
  Experimental,
  Field,
  Proof,
  PublicKey,
  SelfProof,
  Signature,
  Struct,
} from 'snarkyjs';
import ZkProgram = Experimental.ZkProgram;
import {
  MultiSigMerkleWitness,
  ProposalState,
  SignerState,
} from './model';

export class MultiSigProgramState extends Struct({
  state: ProposalState,
}) {
  equals(other: MultiSigProgramState): Bool {
    return this.state.hash().equals(other.state.hash());
  }
}

export class MultiSigProgramStateTransition extends Struct({
  from: MultiSigProgramState,
  to: MultiSigProgramState,
}) {}

export const MultiSigProgramNoProofs = {
  approve: function (
    publicInput: MultiSigProgramStateTransition,
    signer: PublicKey,
    signature: Signature,
    vote: Bool,
    signerWitness: MultiSigMerkleWitness
  ) {
    let proposalState = publicInput.from.state.deepCopy();

    //Program
    signature
      .verify(signer, [proposalState.proposal.hash(), vote.toField()])
      .assertTrue('Signature not valid');

    let signerState = new SignerState({
      pubkey: signer,
      voted: Bool(false),
    });

    signerWitness
      .calculateIndex()
      .assertEquals(signer.x, 'Witness index not equal to signer.x');
    signerWitness
      .calculateRoot(signerState.hash())
      .assertEquals(
        proposalState.signerStateRoot,
        'Signer root not equal to proposalstate'
      );

    signerState.voted = Bool(true);
    proposalState.signerStateRoot = signerWitness.calculateRoot(
      signerState.hash()
    );

    //Change vote
    proposalState.votes[0] = proposalState.votes[0].add(
      Circuit.if(vote, Field(1), Field(0))
    );

    proposalState.votes[1] = proposalState.votes[1].add(
      Circuit.if(vote, Field(0), Field(1))
    );

    publicInput.to.state
      .hash()
      .assertEquals(
        proposalState.hash(),
        'Resulting ProposalState not matching'
      );
  },

  merge: function (
    publicInput: MultiSigProgramStateTransition,
    proof1: MultiSigProgramStateTransition,
    proof2: MultiSigProgramStateTransition
  ) {
    publicInput.from
      .equals(proof1.from)
      .assertTrue('PublicInput -> Proof1 transition not correct');
    proof1.to
      .equals(proof2.from)
      .assertTrue('Proof1 -> Proof2 transition not correct');
    proof2.to
      .equals(publicInput.to)
      .assertTrue('Proof2 -> PublicInput transition not correct');
  },
};

export const MultiSigProgram = ZkProgram({
  publicInput: MultiSigProgramStateTransition,

  methods: {
    approve: {
      privateInputs: [PublicKey, Signature, Bool, MultiSigMerkleWitness],
      method(
        publicInput: MultiSigProgramStateTransition,
        signer: PublicKey,
        signature: Signature,
        vote: Bool,
        signerWitness: MultiSigMerkleWitness
      ) {
        MultiSigProgramNoProofs.approve(
          publicInput,
          signer,
          signature,
          vote,
          signerWitness
        );
      },
    },
    merge: {
      privateInputs: [SelfProof, SelfProof],
      method(
        publicInput: MultiSigProgramStateTransition,
        proof1: SelfProof<MultiSigProgramStateTransition>,
        proof2: SelfProof<MultiSigProgramStateTransition>
      ) {
        proof1.verify();
        proof2.verify();

        publicInput.from
          .equals(proof1.publicInput.from)
          .assertTrue('PublicInput -> Proof1 transition not correct');
        proof1.publicInput.to
          .equals(proof2.publicInput.from)
          .assertTrue('Proof1 -> Proof2 transition not correct');
        proof2.publicInput.to
          .equals(publicInput.to)
          .assertTrue('Proof2 -> PublicInput transition not correct');
      },
    },
  },
});

export class MultisigProgramProof extends Proof<MultiSigProgramStateTransition> {
  static publicInputType = MultiSigProgramStateTransition;
  static tag = () => MultiSigProgram;
}
