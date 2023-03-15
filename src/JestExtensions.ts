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
  Token,
  Types, UInt64,
} from 'snarkyjs';
import fs from 'fs';
import { tic, toc } from './tictoc';

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
    sender: PrivateKey,
    pks: PrivateKey[]
  ) => Promise<void>;
  getDeployArgs: DeployArgsFactory;
  before: () => Promise<void>;
  getAccount: (pk: PublicKey, tokenId?: Field) => Promise<Types.Account>;
  editPermission: Types.AuthRequired;
  defaultFee: UInt64
};

type DeployVK = { data: string; hash: string | Field };

let vkCache: { [key: string]: DeployVK } = {};

export function getTestContext(): TestContext {
  let deployToBerkeley = process.env.TEST_ON_BERKELEY === 'true' ?? false;
  let proofs = process.env.TEST_WITH_PROOFS === 'true' ?? false;

  const signOrProve = async function signOrProve(
    tx: Mina.Transaction,
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
        let { verificationKey } = await smartContract.compile();
        toc();
        vkCache[smartContract.name] = verificationKey;
      }
      let verificationKey = vkCache[smartContract.name];

      return {
        verificationKey,
      };

    } else {
      return { zkappKey: pk };
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
    editPermission: proofs ? Permissions.proof() : Permissions.signature(),
    defaultFee: UInt64.from(0.01 * 1e9)
  };

  let before = async () => {
    await isReady;

    let Blockchain;

    if (deployToBerkeley) {
      Blockchain = Mina.Network(
        // 'https://proxy.berkeley.minaexplorer.com/graphql'
          'https://berkeley.eu2.rpanic.com/graphql'
      );
      Mina.setActiveInstance(Blockchain);
      context.accounts = getBerkeleyAccounts(10);

      let mainPk = context.accounts[0].toPublicKey()

      let requestFaucet = async () => {
        console.log('Requesting funds from faucet to ' + mainPk.toBase58());
        await Mina.faucet(mainPk);
        console.log('Address funded!');
      }

      try{
        let mainAccount = await context.getAccount(mainPk)

        if(mainAccount.balance.toBigInt() === 0n){
          await requestFaucet()
        }else{
          console.log("Account already funded") //If it doesn't throw -> means the account already exists onchain
        }

      }catch (e){
        await requestFaucet()
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

export type EventResponse = {
  events: string[][];
};

export function it2(name: string, f: () => void, timeout?: number) {
  console.log('Disabled ' + name);
}

type SavedKeypair = {
  privateKey: string;
  publicKey: string;
};

let keysDir = "keys";
let keysPath = keysDir + '/berkeley.json';

//Get keys from /keys, or else create them
export function getBerkeleyAccounts(num: number): PrivateKey[] {

  if (fs.existsSync(keysPath)) {
    let json = JSON.parse(
      fs.readFileSync(keysPath).toString()
    ) as SavedKeypair[];
    return json.map((x) => PrivateKey.fromBase58(x.privateKey));
  } else {

    return regenerateBerkeleyAccounts(num)
  }
}

function regenerateBerkeleyAccounts(num: number) {
  if(!fs.existsSync(keysDir)){
    fs.mkdirSync(keysDir)
  }

  let pks: SavedKeypair[] = [];
  for (let i = 0; i < num; i++) {
    let pk = PrivateKey.random()
    pks.push({
      privateKey: pk.toBase58(),
      publicKey: pk.toPublicKey().toBase58()
    });
  }
  fs.writeFileSync(keysPath, JSON.stringify(pks));
  return pks.map(x => PrivateKey.fromBase58(x.privateKey));
}

export const EXTENDED_JEST_TIMEOUT = 30 * 60 * 1000; //30 minutes