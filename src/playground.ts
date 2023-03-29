import {Field, isReady, Mina, PublicKey, shutdown, UInt32, UInt64} from 'snarkyjs';
import { tic, toc } from './tictoc';
import { MultiSigProgram } from './multisig/multisigv2program';
import {expect} from "@jest/globals";
import {Lender} from "./lending/Lender";

await isReady;

// tic('Compiling');
// await MultiSigProgram.compile();
// toc();

let net = Mina.Network({
    mina: 'https://proxy.berkeley.minaexplorer.com/graphql',
    archive: 'https://archive.berkeley.minaexplorer.com/'
})
Mina.setActiveInstance(net)

let lender = new Lender(PublicKey.fromBase58("B62qk6Pqek9rFvoDyHb8YiMvDd96Y7FBPna18jp9TTksmGVHfLRYMbB"))
let events = await lender.fetchEvents()
console.log(events)
console.log(events[0])

// let u1 = UInt64.from(1)
// let u2 = UInt64.from(u1)
//
// console.log(u1)
// console.log(u2)

//
// let events2 = (await Mina.fetchEvents(
//     PublicKey.fromBase58("B62qpk1piJ4wvz4wzs2uZMHjRgNNqbifdYYhorSzdsP2HJRXbhUciqW"),
//     Field(1),
//     // { from: UInt32.from(0) }
// )) as EventResponse[];
// console.log(events2.length)

await shutdown();
