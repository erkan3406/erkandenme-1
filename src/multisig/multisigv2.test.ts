import {
    shutdown,
    PrivateKey,
    Field,
    Mina,
    MerkleTree,
    AccountUpdate,
    UInt64,
    Bool,
    PublicKey,
    Signature, UInt32, Circuit, Types, Permissions, fetchTransactionStatus,
} from 'snarkyjs';
import {beforeEach, afterAll, it, expect} from '@jest/globals';
import {EventResponse, getTestContext, it2} from '../JestExtensions';
import {MultiSigContract, MultiSigEvent} from './multisigv2';
import {TransactionId} from '../utils';
import {
    MultiSigProgram,
    MultiSigProgramNoProofs,
    MultisigProgramProof,
    MultiSigProgramState,
    MultiSigProgramStateTransition,
} from './multisigv2program';
import {
    MULTISIG_MERKLE_HEIGHT,
    MultiSigMerkleWitness,
    Proposal,
    ProposalState,
    SignerState,
} from './model';
import {tic, toc} from '../tictoc';

describe('Multisig - E2E', () => {

    let context = getTestContext()

    let accounts: PrivateKey[],
        deployToBerkeley = context.berkeley;

    async function deployAndFundMultisig(
        signers: MerkleTree,
        signersLength: number,
        k: number,
        amount: UInt64 = UInt64.from(3 * 1e9),
        editPermissionOverride?: Types.AuthRequired
    ): Promise<{
        tx: TransactionId;
        pk: PrivateKey;
        instance: MultiSigContract;
    }> {
        let pk = PrivateKey.random();
        let deployArgs = await context.getDeployArgs(pk, MultiSigContract);

        let contract = new MultiSigContract(pk.toPublicKey());

        let editPermission = editPermissionOverride ?? context.editPermission

        console.log('Init with k = ', k);

        let tx = await Mina.transaction(
            {sender: accounts[0].toPublicKey(), fee: 0.01 * 1e9},
            () => {
                //Pay account creation fee
                AccountUpdate.fundNewAccount(
                    accounts[0].toPublicKey()
                ).requireSignature();

                //Deploy Contract
                contract.deployContract(deployArgs, editPermission);
                if (!context.proofs) {
                    contract.requireSignature();
                }

                //Setup state
                contract.setup(signers.getRoot(), Field(signersLength), Field(k));
                if (!context.proofs) {
                    contract.requireSignature();
                }

                //Fund contract with initial $MINA
                let sendAu = AccountUpdate.create(accounts[0].toPublicKey());
                sendAu.send({
                    to: contract.address,
                    amount,
                });
                sendAu.requireSignature();
            }
        );

        await context.signOrProve(tx, accounts[0], [pk, accounts[0]]);

        let txId = await tx.send();

        return {tx: txId, pk, instance: contract};
    }

    beforeAll(async () => {
        await context.before();

        accounts = context.accounts;

        console.log(
            accounts
                .map((x, i) => i + ': ' + x.toPublicKey().toBase58())
                .reduce((a, b, i) => a + '\n' + b)
        );
    });

    afterAll(() => {
        setInterval(shutdown, 0);
    });

    let contract: MultiSigContract, contractPk: PrivateKey, signers: MerkleTree;

    let numSigners = 3;

    beforeEach(async () => {

        signers = new MerkleTree(MULTISIG_MERKLE_HEIGHT);
        for (let i = 0; i < numSigners; i++) {
            let signer = accounts[2 + i].toPublicKey();
            signers.setLeaf(
                signer.x.toBigInt(),
                new SignerState({
                    pubkey: signer,
                    voted: Bool(false),
                }).hash()
            );
        }

        if (context.proofs) {
            tic('Compiling MultiSigProgram');
            await MultiSigProgram.compile();
            toc();
            tic("Compiling MultiSigContract")
            await context.getDeployArgs(PrivateKey.random(), MultiSigContract)
            toc()
        }
    });

    function computePublicInput(
        proposal: Proposal,
        votes: [Field, Field],
        signer: PublicKey,
        vote: Bool
    ): MultiSigProgramStateTransition {
        let state1 = new ProposalState({
            proposal,
            votes: votes.slice(),
            signerStateRoot: signers.getRoot(),
        });

        signers.setLeaf(
            signer.x.toBigInt(),
            new SignerState({
                pubkey: signer,
                voted: Bool(true),
            }).hash()
        );

        votes[vote.toBoolean() ? 0 : 1] = votes[vote.toBoolean() ? 0 : 1].add(1);

        let state2 = new ProposalState({
            proposal,
            votes: votes.slice(),
            signerStateRoot: signers.getRoot(),
        });

        return new MultiSigProgramStateTransition({
            from: new MultiSigProgramState({
                state: state1,
            }),
            to: new MultiSigProgramState({
                state: state2,
            }),
        });
    }

    async function proveApproval(
        signer: PrivateKey,
        vote: Bool,
        transition: MultiSigProgramStateTransition,
        witness: MultiSigMerkleWitness
    ): Promise<MultisigProgramProof> {
        let signature = Signature.create(signer, [
            transition.from.state.proposal.hash(),
            Bool(true).toField(),
        ]);

        if (context.proofs) {
            tic('Creating approval proof');
            let proof = await MultiSigProgram.approve(
                transition,
                signer.toPublicKey(),
                signature,
                Bool(true),
                witness
            );
            toc();
            return proof;
        } else {
            MultiSigProgramNoProofs.approve(
                transition,
                signer.toPublicKey(),
                signature,
                Bool(true),
                witness
            );

            // let res = Circuit.constraintSystem(() => {
            //     let pi = Circuit.witness(MultiSigProgramStateTransition, () => transition)
            //     let _signer = Circuit.witness(PublicKey, () => signer.toPublicKey())
            //     let _signature = Circuit.witness(Signature, () => signature)
            //     let _vote = Circuit.witness(Bool, () => Bool(true))
            //     let _witness = Circuit.witness(MultiSigMerkleWitness, () => witness)
            //
            //     MultiSigProgramNoProofs.approve(
            //         pi, _signer, _signature, _vote, _witness
            //     )
            // })
            //
            // console.log("Constraintsystem stats:")
            // console.log(res.rows)
            // console.log(res.publicInputSize)
            // console.log(res.gates.length)

            return new MultisigProgramProof({
                maxProofsVerified: 2,
                proof: '',
                publicInput: transition,
            });
        }
    }

    async function mergeProofs(
        proof1: MultisigProgramProof,
        proof2: MultisigProgramProof
    ): Promise<MultisigProgramProof> {
        let transition = new MultiSigProgramStateTransition({
            from: proof1.publicInput.from,
            to: proof2.publicInput.to,
        });

        if (context.proofs) {
            tic('Merging MultiSig proofs');
            let mergedProof = await MultiSigProgram.merge(transition, proof1, proof2);
            toc();
            return mergedProof;
        } else {
            MultiSigProgramNoProofs.merge(
                transition,
                proof1.publicInput,
                proof2.publicInput
            );
            return new MultisigProgramProof({
                maxProofsVerified: 2,
                proof: '',
                publicInput: transition,
            });
        }
    }

    it2(`Test DepositTimelocked - berkeley: ${deployToBerkeley}, proofs: ${context.proofs}`, async () => {

        let {tx, pk, instance} = await deployAndFundMultisig(
            signers,
            numSigners,
            1,
            UInt64.zero,
            Permissions.proofOrSignature()
        );
        contract = instance;
        contractPk = pk;

        await tx.wait();

        let amount = UInt64.from(10000)

        let tx2 = await Mina.transaction({ sender: accounts[0].toPublicKey() }, () => {

            AccountUpdate.createSigned(accounts[0].toPublicKey())
                .balance.subInPlace(amount)

            contract.depositTimelocked(amount, UInt32.from(1))
            if(!context.proofs){
                contract.requireSignature()
            }
        })
        await context.signOrProve(tx2, accounts[0], [contractPk])
        await (await tx2.send()).wait()

        let contractAccount = await context.getAccount(contract.address)
        expect(contractAccount.balance).toEqual(amount)
        expect(contractAccount.timing.isTimed).toEqual(Bool(true))

        //TODO Check event

        // let deployerAccount1 = await context.getAccount(accounts[0].toPublicKey())

        let tx3 = await Mina.transaction({ sender: accounts[0].toPublicKey() }, () => {

            let au = AccountUpdate.createSigned(instance.address)
            au.send({
                to: accounts[0].toPublicKey(),
                amount: amount
            })
            au.requireSignature()

        })
        tx3.sign([contractPk, accounts[0]]) //Only sign, not prove because permissions were set this way, test is still the same but faster

        await expect(async () => { await tx3.send() }).rejects.toBeDefined() //Cannot validate error message, because Error is an object with very weird properties

        // console.log(txId.isSuccess)
        // await txId.wait()

        // let contractAccount2 = await context.getAccount(contract.address)
        // let deployerAccount2 = await context.getAccount(accounts[0].toPublicKey())

        // expect(contractAccount2.balance).toEqual(contractAccount.balance)
        // expect(contractAccount2.nonce).toEqual(contractAccount.nonce)
        //
        // expect(deployerAccount2.balance).toEqual(deployerAccount1.balance)
        // expect(deployerAccount2.nonce).toEqual(deployerAccount1.nonce)

    })

    it(`enabled Test Approve - berkeley: ${deployToBerkeley}, proofs: ${context.proofs}`, async () => {

        let {tx, pk, instance} = await deployAndFundMultisig(
            signers,
            numSigners,
            2
        );
        contract = instance;
        contractPk = pk;

        let proposalReceiver = PrivateKey.random().toPublicKey() //accounts[8]
        let initialReceiverBalance = UInt64.zero // UInt64.from(1000n * 10n ** 9n)
        let receiverFunded = false

        let proposalAmount = UInt64.from(2 * 1e9);
        let proposal = new Proposal({
            receiver: proposalReceiver,
            amount: proposalAmount,
        });
        let votes: [Field, Field] = [Field(0), Field(0)];

        let transition1 = computePublicInput(
            proposal,
            votes,
            accounts[2].toPublicKey(),
            Bool(true)
        );
        let witness1 = signers.getWitness(accounts[2].toPublicKey().x.toBigInt());
        expect(votes[0]).toEqual(Field(1));
        let transition2 = computePublicInput(
            proposal,
            votes,
            accounts[3].toPublicKey(),
            Bool(true)
        );
        let witness2 = signers.getWitness(accounts[3].toPublicKey().x.toBigInt());

        let proof1 = await proveApproval(
            accounts[2],
            Bool(true),
            transition1,
            new MultiSigMerkleWitness(witness1)
        );
        let proof2 = await proveApproval(
            accounts[3],
            Bool(true),
            transition2,
            new MultiSigMerkleWitness(witness2)
        );

        let proof = await mergeProofs(proof1, proof2);

        if (context.proofs) {
            console.log(proof.toJSON());
        }

        expect(proof).toBeDefined();
        console.log('Proofs generated!');

        console.log("Waiting for L1 MultiSig contract to be deployed...")
        await tx.wait();

        let tx2 = await Mina.transaction(
            {sender: accounts[0].toPublicKey()},
            () => {
                contract.approveWithProof(proof);
                if (!context.proofs) {
                    contract.requireSignature();
                }
            }
        );
        await context.signOrProve(tx2, accounts[0], [contractPk]);
        await (await tx2.send()).wait();

        let contractAccount = await context.getAccount(contract.address);
        let receiverAcccount = await context.getAccount(proposalReceiver);

        expect(contractAccount.balance).toEqual(
            UInt64.from(3 * 1e9).sub(proposalAmount)
        );
        expect(receiverAcccount.balance).toEqual(
            initialReceiverBalance.add(proposalAmount).sub(receiverFunded ? UInt64.zero : UInt64.from(1e9))
        );

        expect(contractAccount.zkapp?.appState[1]).toEqual(Field(0))
        expect(contractAccount.zkapp?.appState[2]).toEqual(Field(numSigners))
        expect(contractAccount.zkapp?.appState[3]).toEqual(Field(2)) //k

        let events = (await Mina.fetchEvents(
            contract.address,
            Field(1)
        )) as EventResponse[];

        expect(events.length).toEqual(1)
        expect(events[0].events[0][0]).toEqual("0") //index

        let multiSigEvent = MultiSigEvent.fromFields(
            events[0].events[0].slice(1).map((x) => Field(x))
        )
        expect(multiSigEvent.proposal).toEqual(proposal)
        expect(multiSigEvent.votes[0]).toEqual(Field(2))
        expect(multiSigEvent.votes[1]).toEqual(Field(0))
        expect(multiSigEvent.passed).toEqual(Bool(true))
        expect(multiSigEvent.receiverCreationFeePaid).toEqual(Bool(!receiverFunded))

        //TODO Unfunded account
    });
});
