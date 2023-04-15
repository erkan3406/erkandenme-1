// helpers
import {
    Bool,
    Field,
    isReady,
    MerkleMapWitness,
    Mina,
    PrivateKey, VerificationKey,
} from 'snarkyjs';
import fs from 'fs';

await isReady;

export function createLocalBlockchain(): PrivateKey {
    let Local = Mina.LocalBlockchain({ accountCreationFee: 1e9 });
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
        fs.readFileSync('keys/wallet.json', { encoding: 'utf-8' })
    );
    let pk = PrivateKey.fromBase58(data['privateKey']);
    return pk;
}

export interface ProveMethod {
    verificationKey?: {
        data: string;
        hash: Field | string;
    };
    zkappKey?: PrivateKey;
}

export function dummyVerificationKey() : VerificationKey{
    let data = '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'

    let hash = Field("3392518251768960475377392625298437850623664973002200885669375116181514017494")

    return new VerificationKey({
        data, hash
    })
}

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

export interface TransactionId {
    isSuccess: boolean;

    wait(options?: { maxAttempts?: number; interval?: number }): Promise<void>;

    hash(): string | undefined;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
