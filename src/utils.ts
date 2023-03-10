// helpers
import {
    Bool,
    Field,
    isReady,
    MerkleMap,
    MerkleMapWitness,
    Mina,
    PrivateKey,
    Struct,
} from 'snarkyjs';
import fs from 'fs';
import readline from 'readline';
import util from 'util';

await isReady;

export function createLocalBlockchain(): PrivateKey {
    let Local = Mina.LocalBlockchain({accountCreationFee: 1e9});
    Mina.setActiveInstance(Local);

    const account = Local.testAccounts[0].privateKey;
    return account;
}

export function createBerkeley(): PrivateKey {
    let berkeley = Mina.Network(
        'https://proxy.berkeley.minaexplorer.com/graphql'
    );

    Mina.setActiveInstance(berkeley);

    let data = JSON.parse(
        fs.readFileSync('keys/wallet.json', {encoding: 'utf-8'})
    );
    let pk = PrivateKey.fromBase58(data['privateKey'])!;
    return pk;
}

export interface ProveMethod {
    verificationKey?: {
        data: string;
        hash: Field | string;
    };
    zkappKey?: PrivateKey;
}

// export async function deployMultisig(
//     zkAppInstance: MultiSigContractClass,
//     signers: MerkleMap,
//     signersLength: number,
//     state: MerkleMap,
//     account: PrivateKey,
//     k: number,
//     proveMethod: ProveMethod
// ): Promise<string> {
//
//     let tx = await Mina.transaction({ feePayerKey: account, fee: 0.1 * 1e9 }, () => {
//         AccountUpdate.fundNewAccount(account);
//
//         zkAppInstance.deploy({zkappKey: proveMethod.zkappKey!});
//         // zkAppInstance.setPermissions({
//         //     ...Permissions.default(),
//         //     editState: Permissions.proofOrSignature(),
//         //     send: Permissions.proofOrSignature()
//         // });
//         // zkAppInstance.proposalRoot.set(Field(0))
//
//         console.log("Init with k = ", k);
//
//         // if(proveMethod.zkappKey){
//             zkAppInstance.requireSignature()
//         // }
//     });
//     if(proveMethod.verificationKey){
//         await tx.prove()
//     }
//     tx.sign(proveMethod.zkappKey ? [proveMethod.zkappKey] : [])
//     await tx.send()
//
//     tx = await Mina.transaction(account, () => {
//         zkAppInstance.setup(signers.getRoot(), state.getRoot(), Field(signersLength), Field(k));
//         if(proveMethod.zkappKey){
//             zkAppInstance.requireSignature()
//         }
//     })
//     if(proveMethod.verificationKey){
//         await tx.prove()
//     }
//     tx.sign(proveMethod.zkappKey ? [proveMethod.zkappKey] : [])
//     let txId = await tx.send()
//
//     return txId.hash()
// }
//
//
// export async function printBalance(key: PublicKey) {
//     let x = await Mina.getBalance(key)
//     console.log(key.toBase58() + ": " + x.toString())
// }

// export async function init(
//     account: PrivateKey,
//     zkAppInstance: MultiSigZkApp,
//     zkAppPrivateKey: PrivateKey,
//     signers: PublicKey[],
// ) {
//     let tx = await Mina.transaction({ feePayerKey: account, fee: 100000000 }, () => {
//         zkAppInstance.init(SignerList.constructFromSigners(signers), Field.fromNumber(Math.ceil(signers.length / 2)), Field.fromNumber(signers.length));
//     })
//     await tx.prove()
//     await tx.send().wait()
// }

// async function sendTo(
//     sender: PrivateKey,
//     receiver: PublicKey
// ) {
//     let tx = await Mina.transaction(sender, () => {
//
//         AccountUpdate.createSigned(sender).send({ to: receiver, amount: UInt64.from(1000) })
//
//     })
//     await tx.send();
// }
//
// async function fundNewAccount(
//     payer: PrivateKey,
//     account: PublicKey
// ) {
//     let tx = await Mina.transaction(payer, () => {
//         AccountUpdate.createSigned(payer).send({ to: account, amount: UInt64.from(1) })
//         AccountUpdate.fundNewAccount(payer)
//     })
//     await tx.send();
// }
//
// export async function approve(
//     proposalState: ProposalState,
//     proposalWitness: MerkleMapWitness,
//     signerState: MerkleMap,
//     signer: PrivateKey,
//     vote: Bool,
//     account: PrivateKey,
//     zkAppAddress: PublicKey,
//     proveMethod: ProveMethod
// ) {
//
//     let signature = Signature.create(signer, [proposalState.hash(), vote.toField()])
//
//     let signerWitness = await signerState.getWitness(signer.toPublicKey().x)
//
//     let tx = await Mina.transaction(account, () => {
//         let zkApp = new MultiSigContractClass(zkAppAddress);
//
//         zkApp.doApproveSignature(signer.toPublicKey(), signature, vote, proposalState, proposalWitness, signerWitness)
//
//         if(proveMethod.zkappKey){
//             zkApp.requireSignature()
//         }
//     });
//     try {
//         if(proveMethod.verificationKey){
//             await tx.prove()
//         }
//         tx.sign(proveMethod.zkappKey ? [proveMethod.zkappKey] : [])
//         await tx.send();
//         return true;
//     } catch (err) {
//         console.log(err)
//         return false;
//     }
// }

//Generic Utils

interface Fieldable {
    toFields(): Field[];
}

export function structArrayToFields(...args: Fieldable[]): Field[] {
    return args.map((x) => x.toFields()).reduce((a, b) => a.concat(b), []);
}

//MerkleMap

export class MerkleMapUtils {
    static EMPTY_VALUE = Field(0);

    static checkMembership(
        witness: MerkleMapWitness,
        root: Field,
        key: Field,
        value: Field
    ): Bool {
        let r = witness.computeRootAndKey(value);
        r[0].assertEquals(root, '1');
        r[1].assertEquals(key, '2');
        return Bool(true);
    }

    static computeRoot(
        witness: MerkleMapWitness,
        key: Field,
        value: Field
    ): Field {
        return witness.computeRootAndKey(value)[0];
    }

    // static getValuedWitness(map: MerkleMap, key: Field) : ValuedMerkleTreeWitness{
    //     return new ValuedMerkleTreeWitness({
    //         value: map.get(key),
    //         witness: map.getWitness(key)
    //     })
    // }
}

export async function openConsole() {
    let rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const question = util.promisify(rl.question).bind(rl);

    while (true) {
        let s = await question('> ');
        if ((s as any) === 'exit') {
            break;
        }
        console.log(s);
        console.log(eval(s as any));
    }
}

export interface TransactionId {
    isSuccess: boolean;

    wait(options?: { maxAttempts?: number; interval?: number }): Promise<void>;

    hash(): string | undefined;
}
