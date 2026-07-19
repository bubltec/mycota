# mycota

Reusable NestJS core, extracted from [badthingsforpets.com](https://github.com/GenomeInc/btfp): auth (GitHub/Google OAuth + standalone work-email sign-in), organizational-email professional verification, and a DynamoDB client module. No `process.env` reads inside — every value is injected via `MycotaAuthConfig`, so a consuming app supplies its own secrets/table names/callback URLs instead of inheriting btfp's.

## Modules

- `@btfp/mycota/auth` — `MycotaAuthModule.forRootAsync({ useFactory })`, `JwtAuthGuard`, `VerifiedGuard`, `CurrentUser`, `UsersService`, `EmailCodeService`.
- `@btfp/mycota/professional-verification` — request/confirm/review workflow for "prove you belong to an organization," built on the auth module's email-code flow.
- `@btfp/mycota/dynamo` — `DynamoModule` (global, points at DynamoDB Local when `DYNAMODB_ENDPOINT` is set), `DYNAMO_DOC_CLIENT`, `stripDynamoKeys`.

## Status

Currently consumed as a git submodule inside btfp's pnpm workspace (`vendor/mycota`), not yet published or used by a second project. `@btfp/shared-types` (for the `User`/`AuthProvider` types) is still a `workspace:*` dependency, which only resolves inside a pnpm workspace that has that package — genuine standalone use outside a monorepo isn't wired up yet.

See `apps/bff/src/mycota-config.ts` in the btfp repo for a real example of building `MycotaAuthConfig` from environment variables.
