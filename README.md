# mycota

Reusable NestJS core, extracted from [badthingsforpets.com](https://github.com/GenomeInc/btfp): auth (GitHub/Google OAuth + standalone work-email sign-in), organizational-email professional verification, and a DynamoDB client module. No `process.env` reads inside — every value is injected via `MycotaAuthConfig`, so a consuming app supplies its own secrets/table names/callback URLs instead of inheriting btfp's.

A pnpm + turbo monorepo (same shape as btfp itself), so each concern is its own versionable package instead of one flat bundle — a site that only wants `dynamo` isn't forced to pull in passport/bedrock/ses too, and there's room to add more packages as the framework's reach grows.

## Packages

- **`packages/dynamo`** → `@mycota/dynamo` — `DynamoModule` (global, points at DynamoDB Local when `DYNAMODB_ENDPOINT` is set), `DYNAMO_DOC_CLIENT`, `stripDynamoKeys`. No internal dependencies.
- **`packages/auth`** → `@mycota/auth` — `MycotaAuthModule.forRootAsync({ useFactory })`, `JwtAuthGuard`, `VerifiedGuard`, `CurrentUser`, `UsersService`, `EmailCodeService`. Depends on `@mycota/dynamo`.
- **`packages/professional-verification`** → `@mycota/professional-verification` — request/confirm/review workflow for "prove you belong to an organization," built on `@mycota/auth`'s email-code flow. Depends on `@mycota/auth`.

## Status

Currently consumed as a git submodule inside btfp's pnpm workspace (`vendor/mycota`, with btfp's own `pnpm-workspace.yaml` reaching into `vendor/mycota/packages/*`), not yet published or used by a second project. `@mycota/auth` and `@mycota/professional-verification` still depend on `@btfp/shared-types` (for the `User`/`AuthProvider` types) via `workspace:*`, which only resolves inside a pnpm workspace that has that package — a plain `pnpm install` run standalone inside this repo (outside btfp) won't resolve that one dependency yet. Genuine standalone/multi-site use needs that decoupled first.

See `apps/bff/src/mycota-config.ts` in the btfp repo for a real example of building `MycotaAuthConfig` from environment variables.

## Local development

```bash
pnpm install
pnpm turbo run typecheck lint build
```

(Run from inside btfp's checkout — see Status above for why a fully isolated install doesn't work yet.)
