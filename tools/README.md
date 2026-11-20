# Tools

## Overview
Development utilities, automation scripts, and simulation tools supporting developer workflows and synthetic data generation across the SE121 microservices platform.

## Interface
- **Clerk Demo** (`./clerk-demo`): User batch creation (`create-clerk-users.js`), social activity simulations (`simulate-social-activities.js`), and profile recommendation tests (`update-profiles-and-test-recommendations.js`).

## Invariants
- Execution requires valid Clerk API credentials configured in environment variables or `.env`.

## Side Effects
- Mutates Clerk user accounts and generates mock social events across the microservices backend.

## Verification
- Run: `node tools/clerk-demo/create-clerk-users.js --help`
