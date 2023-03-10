import {
    DeployArgs,
    fetchAccount,
    Field,
    isReady,
    Mina,
    Permissions,
    PrivateKey,
    PublicKey,
    SmartContract,
    Struct,
    Token,
    Types,
} from 'snarkyjs';
import fs from 'fs';
import {tic, toc} from './tictoc';
import {expect} from '@jest/globals';
import {TokenUserEvent} from './lending/LendableToken';

type DeployArgsFactory = (
    pk: PrivateKey,
    smartContract: typeof SmartContract
) => Promise<DeployArgs>;

type TestContext = {
    accounts: PrivateKey[];
    berkeley: boolean;
    proofs: boolean;
    signOrProve: (
        tx: any,
        sender: PrivateKey,
        pks: PrivateKey[]
    ) => Promise<void>;
    getDeployArgs: DeployArgsFactory;
    before: () => Promise<void>;
    getAccount: (pk: PublicKey, tokenId?: Field) => Promise<Types.Account>;
    editPermission: Types.AuthRequired;
};

type DeployVK = { data: string; hash: string | Field };

let vkCache: { [key: string]: DeployVK } = {};

// async function getZkappState(publicKey: PublicKey, tokenId?: string) : Promise<Field[]> {
//     let account = await fetchAccount({ publicKey, tokenId })
//     return account.account?.zkapp?.appState ?? []
// }

export function describeNetworkAware(
    name: string,
    tests: (context: TestContext) => void
): (berkeley: boolean, proofs: boolean) => void {
    return (deployToBerkeley: boolean, proofs: boolean) => {
        describe(name, () => {
            const signOrProve = async function signOrProve(
                tx: any,
                sender: PrivateKey,
                pks: PrivateKey[]
            ) {
                if (proofs) {
                    tic('Proving Tx');
                    await tx.prove();
                    toc();
                    tx.sign([...pks, sender]); //TODO remove pks
                } else {
                    tx.sign([...pks, sender]);
                }
            };

            let deployArgs: DeployArgsFactory = async (
                pk: PrivateKey,
                smartContract: typeof SmartContract
            ) => {
                if (proofs) {
                    if (vkCache[smartContract.name] == undefined) {
                        tic('Compiling ' + smartContract.name);
                        let {verificationKey} = await smartContract.compile();
                        toc();
                        vkCache[smartContract.name] = verificationKey;
                    }
                    let verificationKey = vkCache[smartContract.name];

                    return {
                        verificationKey,
                    };
                } else {
                    return {
                        zkappKey: pk,
                    };
                }
            };

            let context: TestContext = {
                accounts: [],
                berkeley: deployToBerkeley,
                proofs,
                signOrProve,
                getDeployArgs: deployArgs,
                before: async () => {
                    return;
                },
                getAccount: async (publicKey: PublicKey, tokenId?: Field) => {
                    if (deployToBerkeley) {
                        await fetchAccount({
                            publicKey,
                            tokenId: tokenId ? Token.Id.toBase58(tokenId) : undefined,
                        });
                    }
                    return Mina.getAccount(publicKey, tokenId);
                },
                editPermission: proofs
                    ? Permissions.proof()
                    : Permissions.proofOrSignature(),
            };

            let before = async () => {
                await isReady;

                let Blockchain;

                if (deployToBerkeley) {
                    Blockchain = Mina.Network(
                        'https://proxy.berkeley.minaexplorer.com/graphql'
                    );
                    //TODO More PKs
                    context.accounts = getBerkeleyAccounts(10);

                    console.log('Requesting funds from faucet');
                    await Mina.faucet(context.accounts[0].toPublicKey());
                    console.log('Address funded!');
                } else {
                    let localBC = Mina.LocalBlockchain({
                        proofsEnabled: proofs,
                        enforceTransactionLimits: true,
                    });
                    Blockchain = localBC;
                    context.accounts = localBC.testAccounts.map((x) => x.privateKey);
                }
                Mina.setActiveInstance(Blockchain);
            };

            context.before = before;

            tests(context);
        });
    };
}

export function it2(name: string, f: () => void) {
    console.log('Disabled');
}

//Get keys from /keys, or else create them
export function getBerkeleyAccounts(num: number): PrivateKey[] {
    let keysPath = 'keys/berkeley.json';
    if (fs.existsSync(keysPath)) {
        let json = JSON.parse(fs.readFileSync(keysPath).toString()) as any[];
        return json.map((x) => PrivateKey.fromBase58(x.privateKey));
    } else {
        let pks = [];
        for (let i = 0; i < num; i++) {
            pks.push(PrivateKey.random());
        }
        fs.writeFileSync(keysPath, JSON.stringify(pks));
        return pks;
    }
}
