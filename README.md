# mycota

Reusable NestJS core, extracted from [badthingsforpets.com](https://github.com/bubltec/btfp): auth (GitHub/Google OAuth + standalone work-email sign-in), organizational-email professional verification, a DynamoDB client module, and SSM-backed configuration management. No `process.env` reads inside `@bubltec/mycota-auth` or `@bubltec/mycota-config` — everything is passed in explicitly, so a consuming app supplies its own secrets/table names/callback URLs instead of inheriting anyone else's.

A pnpm + turbo monorepo (same shape as btfp itself), so each concern is its own versionable package instead of one flat bundle — a project that only wants `dynamo` isn't forced to pull in passport/bedrock/ses too, and there's room to add more packages as the framework's reach grows.

## Packages

- **`packages/dynamo`** → `@bubltec/mycota-dynamo` — `DynamoModule` (global, points at DynamoDB Local when `DYNAMODB_ENDPOINT` is set), `DYNAMO_DOC_CLIENT`, `stripDynamoKeys`. No internal dependencies.
- **`packages/config`** → `@bubltec/mycota-config` — SSM Parameter Store-backed configuration, namespaced by app and environment. No internal dependencies. See below.
- **`packages/auth`** → `@bubltec/mycota-auth` — `MycotaAuthModule.forRootAsync({ useFactory })`, `JwtAuthGuard`, `VerifiedGuard`, `CurrentUser`, `UsersService`, `EmailCodeService`, plus the SSM convenience `buildMycotaAuthConfigFromSsm`. Depends on `@bubltec/mycota-dynamo` and `@bubltec/mycota-config`.
- **`packages/professional-verification`** → `@bubltec/mycota-professional-verification` — request/confirm/review workflow for "prove you belong to an organization," built on `@bubltec/mycota-auth`'s email-code flow. Depends on `@bubltec/mycota-auth`.
- **`packages/cdk`** → `@bubltec/mycota-cdk` — CDK constructs for the config story above: `grantSsmConfigRead` and the `EphemeralConfig` construct. Depends on `@bubltec/mycota-config`; `aws-cdk-lib`/`constructs` are peer dependencies (bring your own pinned CDK version). See below.
- **`packages/payments`** → `@bubltec/mycota-payments` — `PaymentGateway` port, `FakePaymentGateway` for local/tests, and a `StripePaymentGateway` that destination-charges Stripe Connect accounts. No Nest, no `stripe` SDK dependency — the consuming app passes a Stripe-shaped client in. Swap Stripe for Adyen/Square later by implementing the same port.
- **`packages/social`** → `@bubltec/mycota-social` — `SocialPublisher` port, a capability map that is honest about what each official API can actually do (TikTok is draft-only until partnership approval; Instagram Stories are not claimed), a `SocialPublisherRegistry` for fan-out, plus Meta / TikTok / X adapters over injected `fetch`.

## Configuration management (`@bubltec/mycota-config`)

The core idea: real config lives in SSM Parameter Store under
`/{namespace}/{env}/{key}` (plus `/{namespace}/shared/{key}` for values every
environment shares), where **`env` is any string, not a fixed `'dev' |
'prod'` enum** — `pr-123`, a branch name, whatever your CI generates for an
ephemeral preview stack, works with zero code changes.

```ts
import { loadSsmConfig, pushSsmConfig, cloneSsmNamespace, deleteSsmNamespace } from '@bubltec/mycota-config';

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

`@bubltec/mycota-auth` builds on this with `buildMycotaAuthConfigFromSsm({
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
on teardown. `@bubltec/mycota-cdk` (below) closes the loop at the infra layer too —
an actual construct that calls these primitives from a Lambda-backed
CloudFormation custom resource, so an ephemeral stack's own CDK app can
provision and tear down its config without any project-specific glue code.

## CDK constructs (`@bubltec/mycota-cdk`)

mycota is opinionated about CDK as its IaC layer — same TypeScript-first
reasoning as the rest of the framework, no context-switch to a separate
templating language, and it's what btfp itself already deploys with.

```ts
import { grantSsmConfigRead, EphemeralConfig } from '@bubltec/mycota-cdk';

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

Published to the public npm registry under the `@bubltec` scope:
`@bubltec/mycota-config`, `@bubltec/mycota-dynamo`, `@bubltec/mycota-auth`,
`@bubltec/mycota-professional-verification`, `@bubltec/mycota-cdk`.
`@bubltec/mycota-payments` and `@bubltec/mycota-social` are in-tree and will
publish on the next lockstep release. All packages version in lockstep. The checked-in `version` field in each package.json is
a permanent placeholder (`0.0.0`) — it's never authoritative; CI computes
the real version fresh at publish time from git tags.

Two release paths, both driven by CI on every relevant push to `main`
(`.github/workflows/ci.yml`):

- **Real release** — if the triggering commit's message contains
  `#major`, `#minor`, or `#patch` (put the marker in the **PR title**,
  since that's what a squash-merge commit's subject becomes verbatim),
  CI bumps the version accordingly from the latest `vX.Y.Z` git tag,
  publishes under the `latest` dist-tag, pushes the new tag, and creates a
  GitHub Release.
- **Rolling prerelease** — every other relevant push publishes under the
  `next` dist-tag, versioned as the latest real tag's patch+1 plus a
  `-next.<run-number>` suffix (e.g. `1.2.1-next.43`). No git tag, no
  GitHub Release — purely ephemeral, same as before.

A push does one or the other, never both.

Install whichever packages you need:

```bash
pnpm add @bubltec/mycota-auth @bubltec/mycota-config @bubltec/mycota-dynamo
# or, to track the rolling prerelease instead of the latest real release:
pnpm add @bubltec/mycota-auth@next @bubltec/mycota-config@next @bubltec/mycota-dynamo@next
```

Because `@bubltec/mycota-auth`'s internal deps (`@bubltec/mycota-config`,
`@bubltec/mycota-dynamo`) are ordinary published dependencies, installing
`@bubltec/mycota-auth` alone pulls them in transitively — no workspace
linking, no submodule, no manual build step required.

To pick up a newer build later, re-run `pnpm add <pkg>` (or `<pkg>@next`)
— npm/pnpm dependency versions are pinned at install time, not
auto-updating, so this is a deliberate "pull latest" action, not a
persistent floating reference.

No package here depends on anything outside this repo (the
`@btfp/shared-types` coupling this README used to flag has been removed —
`User`/`AuthProvider` are defined locally in `@bubltec/mycota-auth` now).

For a fast local edit-and-test loop against a consuming project without
waiting for a dev publish: `pnpm link --global` from each package directory
here, then `pnpm link --global @bubltec/mycota-auth` (etc.) in the
consuming project.

See `apps/bff/src/mycota-config.ts` in the btfp repo for a real (pre-SSM,
env-var-based) example of building `MycotaAuthConfig` by hand — worth
comparing against `buildMycotaAuthConfigFromSsm` above to see what the SSM
convention saves you from writing yourself.

## Local development

```bash
pnpm install
pnpm turbo run typecheck lint build test
```

Runs standalone — no btfp parent checkout needed.
