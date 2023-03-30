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
    Signature, UInt32, Circuit, Types, Permissions, fetchTransactionStatus, fetchLastBlock,
} from 'snarkyjs';
import {beforeEach, afterAll, it, expect} from '@jest/globals';
import { EXTENDED_JEST_TIMEOUT, getTestContext, it2} from '../JestExtensions';
import {FundsLockedEvent, MultiSigContract, MultiSigEvent} from './multisigv2';
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
import config from "../../config.json"

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

        let tx = await Mina.transaction(
            {sender: accounts[0].toPublicKey(), fee: context.defaultFee},
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

        if (context.proofs) {
            tic('Compiling MultiSigProgram');
            await MultiSigProgram.compile();
            toc();
            tic("Compiling MultiSigContract")
            await context.getDeployArgs(PrivateKey.random(), MultiSigContract)
            toc()
        }

    }, EXTENDED_JEST_TIMEOUT);

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
    }, EXTENDED_JEST_TIMEOUT);

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

    it(`Test DepositTimelocked - berkeley: ${deployToBerkeley}, proofs: ${context.proofs}`, async () => {

        console.log("Starting timelock test")

        let {tx, pk, instance} = await deployAndFundMultisig(
            signers,
            numSigners,
            1,
            UInt64.zero,
            Permissions.proofOrSignature()
        );
        contract = instance;
        contractPk = pk;

        await context.waitOnTransaction(tx);

        let amount = UInt64.from(10000)
        let time = UInt32.from(100)

        let blockchainLength
        if(context.berkeley){
            blockchainLength = (await fetchLastBlock(config.networks.berkeley.mina)).globalSlotSinceGenesis.toBigint()
        }else{
            blockchainLength = Mina.getNetworkState().globalSlotSinceGenesis.toBigint()
        }

        let tx2 = await Mina.transaction({ sender: accounts[0].toPublicKey(), fee: context.defaultFee }, () => {

            AccountUpdate.createSigned(accounts[0].toPublicKey())
                .balance.subInPlace(amount)

            contract.depositTimelocked(amount, time)
            if(!context.proofs){
                contract.requireSignature()
            }
        })
        await context.signOrProve(tx2, accounts[0], [contractPk])
        await context.waitOnTransaction(await tx2.send())

        let contractAccount = await context.getAccount(contract.address)
        expect(contractAccount.balance).toEqual(amount)

        if(context.berkeley) {
            expect(contractAccount.timing.isTimed).toEqual(Bool(true))
            expect(contractAccount.timing.initialMinimumBalance).toEqual(amount)
            expect(contractAccount.timing.vestingPeriod).toEqual(UInt32.one)
            expect(contractAccount.timing.vestingIncrement).toEqual(amount)
            expect(contractAccount.timing.cliffAmount).toEqual(UInt32.zero)
            expect(contractAccount.timing.cliffTime.toBigint()).toBeLessThanOrEqual(blockchainLength + time.toBigint())
            if (context.berkeley) { //Only on berkeley because blockchainLength will by 0 on localBlockchain
                expect(contractAccount.timing.cliffTime.toBigint()).toBeGreaterThan(blockchainLength)
            }
        }

        let events = await context.fetchEvents(() => contract.fetchEvents(), { expectedLength : 1})
        expect(events.length).toBeGreaterThanOrEqual(1)

        let event = events[0].event as unknown as FundsLockedEvent
        expect(event.amount).toEqual(amount)
        expect(event.time).toEqual(time)

        let tx3 = await Mina.transaction({ sender: accounts[0].toPublicKey() }, () => {

            let au = AccountUpdate.createSigned(instance.address)
            au.send({
                to: accounts[0].toPublicKey(),
                amount: amount
            })

        })
        //TODO Fix this
        tx3.sign([contractPk, accounts[0]]) //Only sign, not prove because permissions were set this way, test is still the same but faster

        await expect(async () => { await tx3.send() }).rejects.toBeDefined() //Cannot validate error message, because Error is an object with very weird properties

    }, EXTENDED_JEST_TIMEOUT)

    it(`enabled Test Approve - berkeley: ${deployToBerkeley}, proofs: ${context.proofs}`, async () => {

        console.log("Starting approve test")

        let {tx, pk, instance} = await deployAndFundMultisig(
            signers,
            numSigners,
            2
        );
        contract = instance;
        contractPk = pk;

        expect(tx.isSuccess).toEqual(true)

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

        console.log(`Waiting for L1 MultiSig contract to be deployed... (${context.berkeley ? tx.hash() : "localtx"})`)
        await context.waitOnTransaction(tx);

        await context.getAccount(contract.address)

        let tx2 = await Mina.transaction(
            {sender: accounts[0].toPublicKey(), fee: context.defaultFee},
            () => {
                contract.approveWithProof(proof);
                if (!context.proofs) {
                    contract.requireSignature();
                }
            }
        );
        await context.signOrProve(tx2, accounts[0], [contractPk]);
        let txId2 = await tx2.send()

        await context.waitOnTransaction(txId2)

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

        let events = await context.fetchEvents(() => contract.fetchEvents(), {expectedLength: 1})

        expect(events.length).toBeGreaterThanOrEqual(1)

        let multiSigEvent = events[0].event as unknown as MultiSigEvent
        expect(multiSigEvent.proposal).toEqual(proposal)
        expect(multiSigEvent.votes[0]).toEqual(Field(2))
        expect(multiSigEvent.votes[1]).toEqual(Field(0))
        expect(multiSigEvent.passed).toEqual(Bool(true))
        expect(multiSigEvent.receiverCreationFeePaid).toEqual(Bool(!receiverFunded))

        //TODO Unfunded account

    }, EXTENDED_JEST_TIMEOUT);
});
