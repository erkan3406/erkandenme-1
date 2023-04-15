# Mina-E2E testing

## Contracts

### Multisig

#### Summary

The Multisig contract is a simple implementation of a multisig wallet, 
which pays out mina if a certain amount of signers have signed a proposal.
The implementation consists of a on-chain contract and a ZkProgram to compose signatures off-chain. 

#### MultiSigContract 
A SmartContract that holds funds and keeps track of the current proposal and the signers permitted to sign proposals. 
Accepts a proof from MultiSigProgram to release funds to a certain address.

#### MultiSigProgram
A ZkProgram that verifies signatures of signers and also keeps track of which signers already signed the proposal.
Proofs can be merged to be committed once to chain. 

#### Surface Areas

- 1: Recursion: The ZkProgram uses Recursion to merge proofs
- 2: Call stack composability:
    - Creation of child AccountUpdates to send mina tokens
    - Creation of child AccountUpdates to pay the account creation fee from the proposal amount in case the proposal receiver is a new account. 

- 4: Events: All Operations emit events and are tested accordingly
- 5: Preconditions (account): 
    - The isNew property is used to determine if the account creation fee has to be deducted
    - Timing precondition in `depositTimelocked()` with reject test
    - Balance Precondition to ensure contract can pay out proposal

- 6: Preconditions (network): Various network-based preconditions:
    - globalSlotSinceGenesis
- 7: Permissions
- 8: Deploy Smart Contract: Tests deploy all contracts dynamically at runtime and check deployment success

#### Runtime

Berkeley: 
- DepositTimelocked: 16m
- Approve: 21m

### Lending

#### Summary

The Lending protocol allows users to borrow assets overcollateralized.
Users add liquidity to the system in the form of tokens, where every token has the price of 1.
Then, the user can borrow any other assets in the protocol which has liquidity against his/her collateral and not above that.

Covered Surface Areas:

- 2: Call stack composability:

    The Lending example uses the token api with the TokenHolder pattern. 
    To explain, there is the Lender contract which is deployed as a normal Mina contract, which saves the balances of all users,
    their already borrowed amounts and acts as the main gateway into the protocol.

    Then there is the LendableToken Contract, which is the token owner for any contracts
    The last contract is the LenderTokenHolder contract, which is deployed on token-specific accounts but on the same address as the Lender contract.
    It's duties are to approve any token transfers out of the Lender-address.
    The different contracts all interact with each other in various ways.


- 3: Actions/Reducer: 

    The `addLiquidity()` method is used for adding Liquidity to the Lender contract. The method deducts the tokens from the user's balance 
    and emits an action to include the deposit into the deposit state-tree. 

    The `rollupLiquidity()` includes all pending actions into the deposit state-tree (`userLiquidityRoot`). 
    To do that, it makes use of the static `witnessService` which generates witnesses for the merkle-tree operations 
    and feeds them into the circuit (that also tests `Circuit.witness()` inside `reduce`).


- 4: Events: All Operations emit events and are tested accordingly
- 6: Preconditions (network): Lender reasonably tests a few network preconditions
- 7: Permissions: All permissions, but especially Token-account permission flow
- 8: Deploy Smart Contract: Tests deploy all contracts dynamically at runtime and check deployment success
- 9: Tokens: This example relies heavily on the token api. See 2. for more details.

#### Runtime

Berkeley:
- Basic token functionality: 16m
- Adding liquidity and borrowing: 45m

## Usage

Deployment of zkapps will automatically be handled by `npm run test`

Following environment variables can be set:
- `TEST_ON_BERKELEY`: Whether the test should be run on berkeley `default: false`
- `TEST_WITH_PROOFS`: Whether the test should compute real proofs `default: false`

Default values can be changed in JestExtensions.ts

### Keys

Keys are created and cached in `keys/berkeley.json`. 
This should **not** be used with other tests which are not included in this repository but replaced with another key coordination solution.

`Lender.test.ts` uses keys indexed 0-9, `multisigv2.test.ts` uses keys indexed 10-19

### Deployed contract instances

#### Multisig

MultiSigContract: \
`B62qnMUHLXVexxJ9B9MtnvDVc7w3PvwZt6GShHW94gq5ZwhpWjT1TzY` \
vk: `14257079870828988549611019054609206084982859505791456513222171868063484008`

#### Lender

LendableToken: \
`B62qmSKBEdghfuYWovUjxsq9y8EHk7k2WqYyYtvW6985nHJsc7Nmff3` \
owning token `xi4hzVt4KCtZe1f58DiqU5gmeABUjtsWtzyn6bStAfdmM2zRG9` \
vk `22983356711181459403927302112639099218335358243153648560156544835613556226580`

Lender: \
`B62qjXh6wqsY1MJNRXztHD3dqRqPiEExfeLhhxaz2BMBSnRBPTEUQ2f` \
vk: `	14589709161595939585563764191844694997630046707080867651446792261852975255135`

LenderTokenHolder: \
`B62qjXh6wqsY1MJNRXztHD3dqRqPiEExfeLhhxaz2BMBSnRBPTEUQ2f`\
@ `xi4hzVt4KCtZe1f58DiqU5gmeABUjtsWtzyn6bStAfdmM2zRG9` \
vk: `16087252393066505873524118668148355338162671671214107442009354807741699063636`


### How to run tests

```sh
npm run test
```

### License

[Apache-2.0](LICENSE)
