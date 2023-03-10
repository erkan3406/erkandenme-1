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
    Signature,
} from 'snarkyjs';
import {beforeEach, afterAll, it, expect} from '@jest/globals';
import {describeNetworkAware} from '../JestExtensions';
import {MultiSigContract} from './multisigv2';
import {TransactionId} from '../utils';
import {
    MultiSigProgram,
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

describeNetworkAware('Multisig - E2E', (context) => {
    let accounts: PrivateKey[],
        deployToBerkeley = context.berkeley;

    async function deployAndFundMultisig(
        signers: MerkleTree,
        signersLength: number,
        k: number
    ): Promise<{
        tx: TransactionId;
        pk: PrivateKey;
        instance: MultiSigContract;
    }> {
        let pk = PrivateKey.random();
        let deployArgs = await context.getDeployArgs(pk, MultiSigContract);

        console.log(deployArgs)

        let contract = new MultiSigContract(pk.toPublicKey());

        let tx = await Mina.transaction(
            {sender: accounts[0].toPublicKey(), fee: 0.01 * 1e9},
            () => {
                //Pay account creation fee
                AccountUpdate.fundNewAccount(
                    accounts[0].toPublicKey()
                ).requireSignature();

                //Deploy Contract
                contract.deployContract(deployArgs, context.editPermission);
                if (!context.proofs) {
                    contract.requireSignature();
                }
                console.log('Init with k = ', k);

                //Setup state
                contract.setup(signers.getRoot(), Field(signersLength), Field(k));
                if (!context.proofs) {
                    contract.requireSignature();
                }

                //Fund contract with initial $MINA
                let sendAu = AccountUpdate.create(accounts[0].toPublicKey());
                sendAu.send({
                    to: contract.address,
                    amount: UInt64.from(3 * 1e9),
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

    beforeEach(async () => {
        let numSigners = 3;

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

        if(context.proofs){
            tic('Compiling MultiSigProgram');
            await MultiSigProgram.compile();
            toc();
        }

        let {tx, pk, instance} = await deployAndFundMultisig(
            signers,
            numSigners,
            2
        );
        contract = instance;
        contractPk = pk;

        await tx.wait();
    });

    function computePublicInput(
        proposal: Proposal,
        votes: [Field, Field],
        signer: PublicKey,
        vote: Bool
    ): MultiSigProgramStateTransition {
        let state1 = new ProposalState({
            proposal,
            votes,
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
            votes,
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

        let signature1 = Signature.create(signer, [
            transition.from.state.proposal.hash(),
            Bool(true).toField(),
        ]);
        tic('Creating approval proof');
        let proof = await MultiSigProgram.approve(
            transition,
            signer.toPublicKey(),
            signature1,
            Bool(true),
            witness
        );
        toc();
        return proof;

    }

    async function mergeProofs(
        proof1: MultisigProgramProof,
        proof2: MultisigProgramProof
    ): Promise<MultisigProgramProof> {

        let transition = new MultiSigProgramStateTransition({
            from: proof1.publicInput.from,
            to: proof2.publicInput.to,
        });
        tic('Merging MultiSig proofs');
        let mergedProof = await MultiSigProgram.merge(transition, proof1, proof2);
        toc();
        return mergedProof;

    }

    it(' enabled Test Approve', async () => {

        let proposalAmount = UInt64.from(1000);
        let proposal = new Proposal({
            receiver: accounts[8].toPublicKey(),
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

        let proof: MultisigProgramProof;

        if (context.proofs) {

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

            proof = await mergeProofs(proof1, proof2);

        } else {

            let mergedTransition = new MultiSigProgramStateTransition({
                from: transition1.from,
                to: transition2.to,
            });

            proof = MultisigProgramProof.fromJSON({
                maxProofsVerified: 2,
                proof: '',
                publicInput: MultiSigProgramStateTransition.toFields(
                    mergedTransition
                ).map((x) => x.toString()),
            });
        }

        console.log(proof.toJSON());

        expect(proof).toBeDefined();
        console.log('Proofs generated!');

        let tx = await Mina.transaction(
            {sender: accounts[0].toPublicKey()},
            () => {
                contract.approveWithProof(proof);
                if (!context.proofs) {
                    contract.requireSignature();
                }
            }
        );
        await context.signOrProve(tx, accounts[0], [contractPk]);

        let contractAccount = await context.getAccount(contract.address);
        let receiverAcccount = await context.getAccount(accounts[8].toPublicKey());

        expect(contractAccount.balance).toEqual(
            UInt64.from(3 * 1e9).sub(proposalAmount)
        );
        expect(receiverAcccount.balance).toEqual(
            UInt64.from(1000n * 10n ** 9n).add(proposalAmount)
        );
        //TODO Unfunded account
    });
})(false, true);
