# Mina-e2e testing

## Contracts

### Multisig

1 - Recursion: Done

2 - Call stack composability: 
   Sending of mina tokens
   AccountUpdate creation for paying account creation fee

4 - Events:
5 - Preconditions (account):
6 - Preconditions (network):
GlobalSlot
7 - Permissions:
8 - Deploy SC:

Tests to implement:
 - X depositTimelocked ( + isTimed )
 - Not-permitted Transactions
 - Events correctly emitted

### Lending

The Lending protocol allows users to borrow assets overcollateralized.
Users add liquidity to the system in the form of tokens, where every token has the price of 1.
Then, the user can borrow any other assets in the protocol which has liquidity against his/her collateral and not above that.

Covered Surface Areas:

2 - Call stack composability:

3 - Actions/Reducer: 
AddLiquidity - Rollup
Maybe Token operations? (Approvals? Would be easy)

4 - Events
5 - Preconditions (account):
6 - Preconditions (network):
9 - Tokens:

Tests to implement:
Events correctly emitted

## Surface Areas

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

# Notes

I am planning on using a recursive version of my multisig-app I built a few months back (was never released though) and expand and polish it. I estimate this app can cover Surface Areas 1, 4, 5, 7 and 8. The second one zkApp will be a simple lending zkApp. It allows users to deposit and lend different custom tokens and it will use actions for concurrency and use calls between contracts to compose the platform contracts and token-managing contracts. This zkApp will be able to cover the remaning SAs 2, 3, 6, 9 and also cover parts of 4, 5, 7 and 8 again. If you do not see these ideas as a good fit - I am pretty flexible on these and propose new ideas which might cover the topics better.


## Usage

### How to build

```sh
npm run build
```

### How to run tests

```sh
npm run test
npm run testw # watch mode
```

### How to run coverage

```sh
npm run coverage
```

### License

[Apache-2.0](LICENSE)
