import {
    DeployArgs,
    fetchAccount, fetchLastBlock,
    Field,
    isReady,
    Mina,
    Permissions,
    PrivateKey,
    PublicKey,
    SmartContract,
    Token,
    Types,
    UInt64,
} from 'snarkyjs';
import fs from 'fs';
import { tic, toc } from './tictoc';
import {sleep, TransactionId} from "./utils";
import config from '../config.json';

type DeployArgsFactory = (
    pk: PrivateKey,
    smartContract: typeof SmartContract
) => Promise<DeployArgs>;

type TestContext = {
    accounts: PrivateKey[];
    berkeley: boolean;
    proofs: boolean;
    signOrProve: (
        tx: Mina.Transaction,
        ...pks: PrivateKey[]
    ) => Promise<void>;
    getDeployArgs: DeployArgsFactory;
    before: () => Promise<void>;
    getAccount: (pk: PublicKey, tokenId?: Field) => Promise<Types.Account>;
    editPermission: Types.AuthRequired;
    defaultFee: UInt64;
    waitOnTransaction: (tx: TransactionId, timeout?: number) => Promise<void>,
    fetchAccounts: (tx: Mina.Transaction) => Promise<void>,
    fetchEvents: <T>(f: () => Promise<T[]>, options: { numBlocks?: number, expectedLength: number }) => Promise<T[]>
};

type DeployVK = { data: string; hash: string | Field };

let vkCache: { [key: string]: DeployVK } = {};

let key_offset = 0

/**
 * Generates a new TestContext which includes all reusable functions which a Mina test will use.
 * It checks for two environment-variables
 * TEST_ON_BERKELEY
 * TEST_WITH_PROOFS
 * to turn berkeley deployment and proof generation on and off.
 */
export function getTestContext(): TestContext {
    let deployToBerkeley = process.env.TEST_ON_BERKELEY === 'true' ?? false;
    let proofs = process.env.TEST_WITH_PROOFS === 'true' ?? false;

    const signOrProve = async function signOrProve(
        tx: Mina.Transaction,
        ...pks: PrivateKey[]
    ) {
        tic('Proving Tx');
        await tx.prove();
        toc();
        tx.sign(pks);
    };

    let deployArgs: DeployArgsFactory = async (
        pk: PrivateKey,
        smartContract: typeof SmartContract
    ) => {
        if (proofs) {
            if (vkCache[smartContract.name] == undefined) {
                tic('Compiling ' + smartContract.name);
                let { verificationKey } = await smartContract.compile();
                toc();
                vkCache[smartContract.name] = verificationKey;
            }
            let verificationKey = vkCache[smartContract.name];

            return {
                verificationKey,
            };
        } else {
            return { };
        }
    };

    const getAccount = async (publicKey: PublicKey, tokenId?: Field) => {
        if (deployToBerkeley) {
            await fetchAccount({
                publicKey,
                tokenId: tokenId ? Token.Id.toBase58(tokenId) : undefined,
            });
        }
        return Mina.getAccount(publicKey, tokenId);
    }

    let fetchAccounts = async function(tx: Mina.Transaction) {

        if(deployToBerkeley){

            let auPks = tx.transaction.accountUpdates.map(x => { return { pk: x.body.publicKey, token: x.body.tokenId }});
            auPks.push({ pk: tx.transaction.feePayer.body.publicKey, token: Token.Id.default })
            let pks = auPks.filter((value, index, array) => array.indexOf(value) === index)

            for(let pk of pks){
                await fetchAccount({ publicKey: pk.pk, tokenId: pk.token })
            }

        }

    }

    let fetchEvents = async function<T>(f: () => Promise<T[]>, options: { numBlocks?: number, expectedLength: number }) : Promise<T[]> {

        if(!deployToBerkeley){
            return await f()
        }

        let maxBlocks = BigInt((options.numBlocks ?? 3) - 1) //By default, wait for 2 more blocks if the inclusion block fails

        let startBlock = -1n;
        let latestBlock = 0n;

        let timeout = 5000;

        while(latestBlock <= startBlock + maxBlocks) {

            let currentBlock = (await fetchLastBlock(config.networks.berkeley.mina)).blockchainLength.toBigint()

            if(latestBlock < currentBlock){
                let events = await f()
                if(events.length >= options.expectedLength){
                    return events
                }

                latestBlock = currentBlock
                if(startBlock === -1n){
                    startBlock = currentBlock
                }
            }

            await sleep(timeout)
        }

        throw Error("Events did not dispatch or archive node didn't retrieve them")

    }

    let context: TestContext = {
        accounts: [],
        berkeley: deployToBerkeley,
        proofs,
        signOrProve,
        getDeployArgs: deployArgs,
        before: async () => {
            return;
        },
        getAccount,
        editPermission: Permissions.proof(),//proofs ? Permissions.proof() : Permissions.signature(),
        defaultFee: UInt64.from(0.01 * 1e9),
        waitOnTransaction: async (tx: TransactionId, timeout?: number) => {

            console.log("Waiting for tx" + (deployToBerkeley ? " " + tx.hash() : "") + " to be mined")

            if(!tx.isSuccess){
                console.warn("returning immediately because the transaction was not successful.")
                return
            }

            let running = true
            let counter = 0
            let timeoutId = setTimeout(() => {
                throw new Error("Timeout reached while waiting for a new block")
            }, timeout ?? 30 * 60 * 1000)
            while(running){
                try{
                    await tx.wait()
                    running = false
                }catch(e){
                    console.log(e)
                    console.log("Continuing to wait (" + counter + ")")
                }
                if(counter >= 10){
                    return
                }
                counter++
            }
            clearTimeout(timeoutId)
            console.log("Tx mined!")

            return
        },
        fetchAccounts,
        fetchEvents
    };

    let before = async () => {
        await isReady;

        let Blockchain;

        if (deployToBerkeley) {
            Blockchain = Mina.Network({
                mina: config.networks.berkeley.mina,
                archive: config.networks.berkeley.archive,
            });
            Mina.setActiveInstance(Blockchain);
            let accounts = getBerkeleyAccounts(20);
            context.accounts = accounts.slice(key_offset).concat(accounts.slice(0, key_offset))
            key_offset += 7

            let mainPk = context.accounts[0].toPublicKey();

            let requestFaucet = async () => {
                console.log(
                    'Requesting funds from faucet to ' + mainPk.toBase58()
                );
                await Mina.faucet(mainPk);

                // let MINA = 10n ** 9n;
                // const facuetValue = 49n * MINA;
                // ledger.addAccount(mainPk, facuetValue.toString())

                console.log('Address funded!');
            };

            try {
                let mainAccount = await context.getAccount(mainPk);

                if (mainAccount.balance.toBigInt() === 0n) {
                    await requestFaucet();
                } else {
                    console.log('Account already funded'); //If it doesn't throw -> means the account already exists onchain
                }
            } catch (e) {
                await requestFaucet();
            }
        } else {
            let localBC = Mina.LocalBlockchain({
                proofsEnabled: proofs,
                enforceTransactionLimits: true,
            });
            Blockchain = localBC;
            context.accounts = localBC.testAccounts.map((x) => x.privateKey);

            Mina.setActiveInstance(Blockchain);
        }
    };

    context.before = before;

    return context;
}

export function it2(name: string, f: () => void, timeout?: number) {
    console.log('Disabled ' + name);
}

type SavedKeypair = {
    privateKey: string;
    publicKey: string;
};

let keysDir = 'keys';
let keysPath = keysDir + '/berkeley.json';

//Get keys from /keys, or else create them
export function getBerkeleyAccounts(num: number): PrivateKey[] {
    if (fs.existsSync(keysPath)) {
        let json = JSON.parse(
            fs.readFileSync(keysPath).toString()
        ) as SavedKeypair[];
        return json.map((x) => PrivateKey.fromBase58(x.privateKey));
    } else {
        return regenerateBerkeleyAccounts(num);
    }
}

function regenerateBerkeleyAccounts(num: number) {
    if (!fs.existsSync(keysDir)) {
        fs.mkdirSync(keysDir);
    }

    let pks: SavedKeypair[] = [];
    for (let i = 0; i < num; i++) {
        let pk = PrivateKey.random();
        pks.push({
            privateKey: pk.toBase58(),
            publicKey: pk.toPublicKey().toBase58(),
        });
    }
    fs.writeFileSync(keysPath, JSON.stringify(pks));
    return pks.map((x) => PrivateKey.fromBase58(x.privateKey));
}

export const EXTENDED_JEST_TIMEOUT = 600 * 60 * 1000; //30 minutes
