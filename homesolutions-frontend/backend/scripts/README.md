# Backend Scripts

Utility scripts used for local setup, testing, and simulation.

## Scripts

- `createAdminAccount.js` - Creates an admin account in the database.
- `seedTestAccounts.js` - Seeds baseline test users and providers.
- `seedAndSimulate.js` - Creates simulated service requests from test accounts.
- `e2ePaymentTest.js` - Runs end-to-end payment flow checks.

## Usage

Run from `homesolutions-frontend/backend`:

```bash
node scripts/createAdminAccount.js
node scripts/seedTestAccounts.js
node scripts/seedAndSimulate.js
node scripts/e2ePaymentTest.js
```

## Script Notes

- Scripts require backend environment variables in `.env`.
- Use test credentials only; do not run simulation scripts against production data.
