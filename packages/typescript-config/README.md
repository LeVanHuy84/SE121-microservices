# @repo/typescript-config

## Overview
Shared TypeScript compiler configuration presets for the SE121 microservices platform, defining strict type-checking and ECMAScript compilation targets for backend NestJS services and shared libraries.

## Interface
- `base.json`: Base configuration with strict type-checking, `moduleResolution: "bundler"`, and declaration generation.
- `nextjs.json`: Next.js-optimized configuration extending `./base.json` with `jsx: preserve` and `noEmit: true`.
- `react-library.json`: React library configuration with React JSX transform and declaration output.

## Invariants
- Base configuration enforces `strict: true` and `forceConsistentCasingInFileNames: true`.
- Derived application configurations must extend `./base.json`.
- `node_modules` and build distribution outputs are globally excluded from compilation.

## Side Effects
- Controls TypeScript compilation, type assertions, and declaration emit across backend workspaces.

## Verification
- Run: `npm run check-types`
