# mycota

Reusable NestJS core, extracted from [badthingsforpets.com](https://github.com/GenomeInc/btfp): auth (GitHub/Google OAuth + standalone work-email sign-in), organizational-email professional verification, a DynamoDB client module, and SSM-backed configuration management. No `process.env` reads inside `@mycota/auth` or `@mycota/config` — everything is passed in explicitly, so a consuming app supplies its own secrets/table names/callback URLs instead of inheriting anyone else's.

A pnpm + turbo monorepo (same shape as btfp itself), so each concern is its own versionable package instead of one flat bundle — a project that only wants `dynamo` isn't forced to pull in passport/bedrock/ses too, and there's room to add more packages as the framework's reach grows.

## Packages

- **`packages/dynamo`** → `@mycota/dynamo` — `DynamoModule` (global, points at DynamoDB Local when `DYNAMODB_ENDPOINT` is set), `DYNAMO_DOC_CLIENT`, `stripDynamoKeys`. No internal dependencies.
- **`packages/config`** → `@mycota/config` — SSM Parameter Store-backed configuration, namespaced by app and environment. No internal dependencies. See below.
- **`packages/auth`** → `@mycota/auth` — `MycotaAuthModule.forRootAsync({ useFactory })`, `JwtAuthGuard`, `VerifiedGuard`, `CurrentUser`, `UsersService`, `EmailCodeService`, plus the SSM convenience `buildMycotaAuthConfigFromSsm`. Depends on `@mycota/dynamo` and `@mycota/config`.
- **`packages/professional-verification`** → `@mycota/professional-verification` — request/confirm/review workflow for "prove you belong to an organization," built on `@mycota/auth`'s email-code flow. Depends on `@mycota/auth`.
- **`packages/cdk`** → `@mycota/cdk` — CDK constructs for the config story above: `grantSsmConfigRead` and the `EphemeralConfig` construct. Depends on `@mycota/config`; `aws-cdk-lib`/`constructs` are peer dependencies (bring your own pinned CDK version). See below.

## Configuration management (`@mycota/config`)

The core idea: real config lives in SSM Parameter Store under
`/{namespace}/{env}/{key}` (plus `/{namespace}/shared/{key}` for values every
environment shares), where **`env` is any string, not a fixed `'dev' |
'prod'` enum** — `pr-123`, a branch name, whatever your CI generates for an
ephemeral preview stack, works with zero code changes.

```ts
import { loadSsmConfig, pushSsmConfig, cloneSsmNamespace, deleteSsmNamespace } from '@mycota/config';

// Fetch everything under /myapp/dev/* + /myapp/shared/*, decrypted, keyed
// by leaf parameter name. Returns {} for an unprovisioned env — never
// throws — so a stack that hasn't been set up yet still boots.
const config = await loadSsmConfig({ namespace: 'myapp', env: 'dev' });

// Write local values up to SSM.
await pushSsmConfig({ namespace: 'myapp', env: 'dev' }, { 'jwt-secret': '...' });

// Ephemeral stack bootstrap: spin up "pr-123" pre-populated from "dev"'s values.
await cloneSsmNamespace({ namespace: 'myapp', sourceEnv: 'dev', targetEnv: 'pr-123' });

// Ephemeral stack teardown: call when the PR closes / the preview stack is destroyed.
await deleteSsmNamespace({ namespace: 'myapp', env: 'pr-123' });
```

A CLI ships too (`mycota-config`), for local dev / CI scripts that would
rather shell out than import: `mycota-config load --namespace myapp --env
dev` prints dotenv-format `KEY=VALUE` lines to stdout (pipe it to a file —
it's real secret values, not names); `push`/`clone`/`delete` mirror the
functions above. A project's own `infra/scripts/secrets.ts`-equivalent
becomes a thin wrapper around this instead of a from-scratch
implementation.

`@mycota/auth` builds on this with `buildMycotaAuthConfigFromSsm({
namespace, env, overrides? })`, which maps a documented SSM key convention
(`jwt-secret`, `web-origin`, `users-table-name`, `email-from-address`,
`session-cookie-name`, `stage`, `aws-region`, `bedrock-inference-profile-id`,
`brave-search-api-key`, `github-client-id`/`github-client-secret`/
`github-callback-url`, `google-*` equivalents) onto `MycotaAuthConfig` —
so wiring a brand-new project's auth to SSM is one call:

```ts
MycotaAuthModule.forRootAsync({
  useFactory: () => buildMycotaAuthConfigFromSsm({ namespace: 'myapp', env: process.env.STAGE! }),
});
```

**Ephemeral stacks — fully covered, runtime and infra.** The four
primitives above are exactly what a PR-preview or throwaway test
environment needs: clone a template environment's config on creation, load
it at runtime (gracefully degraded if it hasn't been cloned yet), delete it
on teardown. `@mycota/cdk` (below) closes the loop at the infra layer too —
an actual construct that calls these primitives from a Lambda-backed
CloudFormation custom resource, so an ephemeral stack's own CDK app can
provision and tear down its config without any project-specific glue code.

## CDK constructs (`@mycota/cdk`)

mycota is opinionated about CDK as its IaC layer — same TypeScript-first
reasoning as the rest of the framework, no context-switch to a separate
templating language, and it's what btfp itself already deploys with.

```ts
import { grantSsmConfigRead, EphemeralConfig } from '@mycota/cdk';

// Generalized version of a single ssm.StringParameter...grantRead(handler)
// call — scope a Lambda/ECS role to read everything under a namespace/env
// (plus shared/ by default) in one line.
grantSsmConfigRead(myLambda, { namespace: 'myapp', env: 'dev' });

// Bootstrap + tear down an ephemeral stack's config from the stack's own
// CDK app: Create clones sourceEnv -> targetEnv, Delete removes targetEnv's
// parameters, Update is a deliberate no-op (never silently overwrite config
// someone hand-tweaked for this one ephemeral env after creation).
new EphemeralConfig(this, 'Config', {
  namespace: 'myapp',
  sourceEnv: 'dev',
  targetEnv: 'pr-123',
});
```

`aws-cdk-lib`/`constructs` are peer dependencies, not bundled — a consuming
project supplies its own pinned CDK version, avoiding the "two copies of
constructs" jsii error that comes from a transitive dependency shipping its
own copy.

## Status

Consumed as a git submodule inside btfp's pnpm workspace (`vendor/mycota`,
with btfp's own `pnpm-workspace.yaml` reaching into
`vendor/mycota/packages/*`) — not yet published or used by a second
project. Genuinely standalone-installable now, though: no package here
depends on anything outside this repo (the `@btfp/shared-types` coupling
this README used to flag has been removed — `User`/`AuthProvider` are
defined locally in `@mycota/auth` now).

See `apps/bff/src/mycota-config.ts` in the btfp repo for a real (pre-SSM,
env-var-based) example of building `MycotaAuthConfig` by hand — worth
comparing against `buildMycotaAuthConfigFromSsm` above to see what the SSM
convention saves you from writing yourself.

## Local development

```bash
pnpm install
pnpm turbo run typecheck build test
```

Runs standalone — no btfp parent checkout needed. Commits use **Lefthook** (`lefthook.yml`) for
oxlint/oxfmt on staged files (same rules as btfp). CI runs typecheck/build/test only — not
full-tree lint or format.

When developing alongside [badthingsforpets](https://github.com/GenomeInc/btfp), btfp vendors
this repo under `vendor/mycota` and links these packages via pnpm workspace. Push changes here
first, then bump the submodule pointer in btfp — see btfp's
[contributing guide](https://github.com/GenomeInc/btfp/blob/main/docs/contributing.md#working-on-mycota-submodule-dependency).
