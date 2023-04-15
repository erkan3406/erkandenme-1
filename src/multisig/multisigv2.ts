import {
    AccountUpdate,
    Bool,
    Circuit,
    DeployArgs,
    Field,
    method,
    Mina,
    SmartContract,
    State,
    state,
    Struct,
    UInt64,
    Permissions,
    Types,
    UInt32,
} from 'snarkyjs';

import {Proposal, ProposalState, SignerState} from './model';
import {MultisigProgramProof} from './multisigv2program';

export class MultiSigEvent extends Struct({
    proposal: Proposal,
    votes: [Field, Field],
    passed: Field, //0 = undecided, 1 = accepted, 2 = declined
    receiverCreationFeePaid: Bool
}) {
}

export class FundsLockedEvent extends Struct({
    amount: UInt64,
    time: UInt32,
}) {
}

export class MultiSigContract extends SmartContract {
    @state(Field) signerRoot = State<Field>();
    @state(Field) proposalState = State<Field>();
    @state(Field) numSigners = State<Field>();
    @state(Field) signerThreshold = State<Field>();

    events = {
        approve: MultiSigEvent,
        locked: FundsLockedEvent,
    };

    @method setup(signerRoot: Field, numSigners: Field, threshold: Field) {
        this.signerRoot.assertEquals(Field(0));
        this.signerThreshold.assertEquals(Field(0));
        this.numSigners.assertEquals(Field(0));

        this.signerRoot.set(signerRoot);
        this.signerThreshold.set(threshold);
        this.numSigners.set(numSigners);
    }

    deployContract(args: DeployArgs, editPermission: Types.AuthRequired) {
        super.deploy(args);
        this.account.permissions.set({
            ...Permissions.default(),
            editState: editPermission,
            editActionState: editPermission,
            incrementNonce: editPermission,
            setVerificationKey: Permissions.impossible(),
            setPermissions: editPermission,
            send: editPermission,
            setTiming: editPermission
        });
    }

    //Should be executed when enough votes have been reached
    @method approveWithProof(proof: MultisigProgramProof) {

        this.signerThreshold.assertEquals(this.signerThreshold.get());
        this.numSigners.assertEquals(this.numSigners.get());
        this.signerRoot.assertEquals(this.signerRoot.get());
        this.proposalState.assertEquals(this.proposalState.get());

        this.account.balance.assertBetween(proof.publicInput.from.state.proposal.amount, UInt64.MAXINT());

        let fromProposalState = proof.publicInput.from.state;

        //Check that proposal is either new and not in the tree or is in the tree
        let proposalStateValue = Circuit.if(
            fromProposalState.caBeNew(),
            Field(0),
            fromProposalState.hash()
        );
        this.proposalState.assertEquals(proposalStateValue);

        let signerTreeRoot = Circuit.if(
            fromProposalState.caBeNew(),
            this.signerRoot.get(),
            fromProposalState.signerStateRoot
        );
        fromProposalState.signerStateRoot.assertEquals(signerTreeRoot);

        //Check if proposal passed/failed
        let proposalState = proof.publicInput.to.state;

        let votesFor = proposalState.votes[0];
        let votesAgainst = proposalState.votes[1];
        let votesReached = votesFor.gte(this.signerThreshold.get());

        let amount = Circuit.if(
            votesReached,
            proposalState.proposal.amount,
            UInt64.from(0)
        );

        //pay account creation fee if necessary
        let accountUpdate = AccountUpdate.create(proposalState.proposal.receiver);
        let isNew = accountUpdate.account.isNew.get();
        accountUpdate.account.isNew.assertEquals(isNew);

        amount = amount.sub(
            Circuit.if(isNew, Mina.accountCreationFee(), UInt64.from(0))
        );
        this.balance.subInPlace(
            Circuit.if(isNew, Mina.accountCreationFee(), UInt64.from(0))
        );

        this.self.send({to: proposalState.proposal.receiver, amount});

        let votesAgainstReached = votesAgainst.gte(
            this.numSigners.get().sub(this.signerThreshold.get())
        );

        let newProposalState = Circuit.if(
            votesReached.or(votesAgainstReached),
            Field(0),
            proposalState.hash()
        );

        this.proposalState.set(newProposalState);

        this.emitEvent(
            'approve',
            new MultiSigEvent({
                proposal: proposalState.proposal,
                votes: proposalState.votes,
                passed: Circuit.if(
                    votesReached,
                    Field(1),
                    Circuit.if(votesAgainstReached, Field(2), Field(0))
                ),
                receiverCreationFeePaid: isNew
            })
        );
    }

    @method
    depositTimelocked(amount: UInt64, time: UInt32) {
        let globalSlot = this.network.globalSlotSinceGenesis.get();
        this.network.globalSlotSinceGenesis.assertBetween(
            globalSlot,
            globalSlot.add(3)
        ); //3 blocks until inclusion should be reasonable

        this.balance.addInPlace(amount);

        let cliffTime = globalSlot.add(time);

        this.account.timing.set({
            initialMinimumBalance: amount,
            vestingPeriod: UInt32.one,
            vestingIncrement: amount,
            cliffTime: cliffTime,
            cliffAmount: UInt64.zero,
        });

        this.emitEvent(
            'locked',
            new FundsLockedEvent({
                amount,
                time,
            })
        );
    }
}
