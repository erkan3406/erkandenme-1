# Mina-e2e testing

TODO:
Remove .requireSignature()

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

1. Recursion: The ZkProgram uses Recursion to merge proofs
2. Call stack composability:
    - Creation of child AccountUpdates to send mina tokens
    - Creation of child AccountUpdates to pay the account creation fee from the proposal amount in case the proposal receiver is a new account. 

- 4: Events: All Operations emit events and are tested accordingly
- 5: Preconditions (account): 
    - The isNew property is used to determine if the account creation fee has to be deducted
    - Timing precondition in `depositTimelocked()` with reject test
    - Balance Precondition to ensure contract can pay out proposal

// - 6: Preconditions (network): Various network-based preconditions
- 7: Permissions
- 8: Deployment

#### Runtime

Berkeley: 
- DepositTimelocked: 
- Approve: 21m

### Lending

#### Summary

The Lending protocol allows users to borrow assets overcollateralized.
Users add liquidity to the system in the form of tokens, where every token has the price of 1.
Then, the user can borrow any other assets in the protocol which has liquidity against his/her collateral and not above that.

Covered Surface Areas:

2. Call stack composability:
The Lending example uses the token api with the TokenHolder pattern. 
To explain, there is the Lender contract which is deployed as a normal Mina contract, which saves the balances of all users,
their already borrowed amounts and acts as the main gateway into the protocol.
Then there is the LendableToken Contract, which is the token owner for any contracts
The last contract is the LenderTokenHolder contract, which is deployed on token-specific accounts but on the same address as the Lender contract.
It's duties are to approve any token transfers out of the Lender-address.
The different contracts all interact with each other in various ways.

3. Actions/Reducer: 
The `addLiquidity()` method is used for adding Liquidity to the Lender contract. The method deducts the tokens from the user's balance 
and emits an action to include the deposit into the deposit state-tree. 
The `rollupLiquidity()` includes all pending actions into the deposit state-tree (`userLiquidityRoot`). 
To do that, it makes use of the static `witnessService` which generates witnesses for the merkle-tree operations 
and feeds them into the circuit (that also tests `Circuit.witness()` inside `reduce`).

5. Events: All Operations emit events and are tested accordingly
7. Preconditions (network): Lender reasonably tests a few network preconditions
8. Tokens: This example relies heavily on the token api. See 2. for more details.

#### Runtime

Berkeley:
- Basic token functionality: 16m
- Adding liquidity and borrowing: 53m

# Notes

#### Surface Areas

1. Recursion
2. Call stack composability
3. Actions
4. Events
5. Pre-conditions (account)
6. Pre-conditions (network)
7. Permissions
    - URI
    - Set Token Symbol
    - Set Timing
    - Set Voting For
    - Set Delegate
8. Deploy Smart Contract
9. Tokens

I am planning on using a recursive version of my multisig-app I built a few months back (was never released though) and expand and polish it. I estimate this app can cover Surface Areas 1, 4, 5, 7 and 8. The second one zkApp will be a simple lending zkApp. It allows users to deposit and lend different custom tokens and it will use actions for concurrency and use calls between contracts to compose the platform contracts and token-managing contracts. This zkApp will be able to cover the remaning SAs 2, 3, 6, 9 and also cover parts of 4, 5, 7 and 8 again. If you do not see these ideas as a good fit - I am pretty flexible on these and propose new ideas which might cover the topics better.


## Usage

Deployment of zkapps will automatically be handled by `npm run test`

Following environment variables can be set:
- `TEST_ON_BERKELEY`: Whether the test should be run on berkeley `default: false`
- `TEST_WITH_PROOFS`: Whether the test should compute real proofs `default: true`

### How to run tests

```sh
npm run test
```

### How to run coverage

```sh
npm run coverage
```

### License

[Apache-2.0](LICENSE)
