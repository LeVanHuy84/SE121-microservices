# @repo/eslint-config

## Overview
Shared ESLint rules and style configurations for the SE121 microservices platform, providing linting consistency across Node.js, NestJS, and Next.js services.

## Interface
- `base.js`: Base ESLint configuration extending standard recommendations with Prettier interop.
- `next.js`: Next.js-specific lint rules extending `next/core-web-vitals`.
- `react-internal.js`: React library lint rules for internal monorepo packages.

## Invariants
- Codebases extending these configurations must maintain Prettier formatting parity.
- Unused variables and unresolved imports are flagged as warnings or errors.

## Side Effects
- Static analysis inspection during `turbo run lint` or CI pipelines; no runtime execution side effects.

## Verification
- Run: `npm run lint`
