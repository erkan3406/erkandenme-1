import {
    Circuit,
    Field,
    isReady,
    MerkleMap,
    MerkleMapWitness,
    PrivateKey,
    PublicKey,
    shutdown,
    Signature
} from "snarkyjs";
import {tic, toc} from "./tictoc";
import {MultiSigProgram} from "./multisig/multisigv2program";

await isReady

let accounts = [PrivateKey.random()]

tic("Compiling")
await MultiSigProgram.compile()
toc()

await shutdown()