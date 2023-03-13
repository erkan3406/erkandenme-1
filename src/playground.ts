import { isReady, shutdown } from 'snarkyjs';
import { tic, toc } from './tictoc';
import { MultiSigProgram } from './multisig/multisigv2program';

await isReady;

tic('Compiling');
await MultiSigProgram.compile();
toc();

await shutdown();
