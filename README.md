# mycota

Reusable NestJS core, extracted from [badthingsforpets.com](https://github.com/bubltec/btfp): auth (GitHub/Google/Apple/Facebook/Microsoft OAuth, passwordless email/SMS one-time codes, standalone work-email sign-in), organizational-email professional verification, a DynamoDB client module, and SSM-backed configuration management. No `process.env` reads inside `@bubltec/mycota-auth` or `@bubltec/mycota-config` — everything is passed in explicitly, so a consuming app supplies its own secrets/table names/callback URLs instead of inheriting anyone else's.

A pnpm + turbo monorepo (same shape as btfp itself), so each concern is its own versionable package instead of one flat bundle — a project that only wants `dynamo` isn't forced to pull in passport/bedrock/ses too, and there's room to add more packages as the framework's reach grows.

## Packages

- **`packages/dynamo`** → `@bubltec/mycota-dynamo` — `DynamoModule` (global, points at DynamoDB Local when `DYNAMODB_ENDPOINT` is set), `DYNAMO_DOC_CLIENT`, `stripDynamoKeys`. No internal dependencies.
- **`packages/config`** → `@bubltec/mycota-config` — SSM Parameter Store-backed configuration, namespaced by app and environment. No internal dependencies. See below.
- **`packages/auth`** → `@bubltec/mycota-auth` — `MycotaAuthModule.forRootAsync({ useFactory })`, `OtpService`, `enablePassportFastifyCompat`, `JwtAuthGuard`, `VerifiedGuard`, `CurrentUser`, `UsersService`, `EmailCodeService`, plus the SSM convenience `buildMycotaAuthConfigFromSsm`. Depends on `@bubltec/mycota-dynamo`, `@bubltec/mycota-config`, `@bubltec/mycota-mail`, and `@bubltec/mycota-sms`.
- **`packages/oauth`** → `@bubltec/mycota-oauth` — a small OAuth 2.1 authorization server for MCP connectors (and other public clients): dynamic client registration, authorization code + PKCE S256, hashed opaque tokens with rotating refresh, consent/sign-in pages, RFC 8414/9728 discovery documents, and `OAuthBearerGuard` for the protected resource (it answers 401 with the `WWW-Authenticate` discovery pointer and re-checks `isAllowed` on every request). Identity is the app's existing `@bubltec/mycota-auth` session, so it never handles passwords. `MycotaOAuthModule.forRootAsync({ useFactory })`; `InMemoryOAuthStore` for tests, `DynamoOAuthStore` over the shared `DYNAMO_DOC_CLIENT`. Register the discovery routes and return hook on the Fastify instance with `registerOAuthWellKnown` / `registerOAuthReturnHook`. Depends on `@bubltec/mycota-auth` and `@bubltec/mycota-dynamo`.
- **`packages/mcp`** → `@bubltec/mycota-mcp` — an MCP server over request/response JSON-RPC (Streamable HTTP, no SSE), hand-rolled because the official SDK's transports assume a long-lived server. `McpServer` is framework-free; `MycotaMcpModule.forRootAsync({ route, useFactory })` serves it behind `@bubltec/mycota-oauth` (401 with the discovery pointer, per-request user re-check, writes attributed `<email> (mcp)`). Also `dtoSchema` (JSON Schema read from class-validator decorators, so tool schemas can't drift from validation) and `dto()` (validate tool arguments with the same DTO). Tool failures return as `isError` results the model can correct. Depends on `@bubltec/mycota-auth` and `@bubltec/mycota-oauth`.
- **`packages/cms`** → `@bubltec/mycota-cms` — a small content engine. Declare each type once with `entityDef` + `defineEntity` (DTO, integrity rules in `fields`, `present`, publish cascade, optional `mcp` block) and get editor REST endpoints, draft/publish, cascading deletes, a cached `ContentService`, and MCP tools (`cmsTools`: get/create/update/publish per entity, plus `delete_draft` and `set_status`) that go through the same validation as the web editor. Single-table `DynamoContentStore` over the shared `DYNAMO_DOC_CLIENT`, `InMemoryContentStore` for tests. `MycotaCmsModule.forRootAsync({ entities, guard, useFactory })`; the app supplies the editor guard. Depends on `@bubltec/mycota-auth`, `@bubltec/mycota-dynamo` and `@bubltec/mycota-mcp`.
- **`packages/professional-verification`** → `@bubltec/mycota-professional-verification` — request/confirm/review workflow for "prove you belong to an organization," built on `@bubltec/mycota-auth`'s email-code flow. Depends on `@bubltec/mycota-auth`.
- **`packages/cdk`** → `@bubltec/mycota-cdk` — CDK constructs: `grantSsmConfigRead`, `EphemeralConfig`, `MediaBucket` (private S3 + CloudFront OAC), `JobQueue` (SQS + DLQ + EventBridge Scheduler group), `PostgresInstance` (RDS Postgres 16; app brings the VPC), `SesDomain` (verified sending identity + Easy DKIM + MAIL FROM), and `GithubActionsDeployRole` (GitHub OIDC assume-role for `cdk deploy`). Depends on `@bubltec/mycota-config`; `aws-cdk-lib`/`constructs` are peer dependencies (bring your own pinned CDK version). See below.
- **`packages/payments`** → `@bubltec/mycota-payments` — `PaymentGateway` port, `FakePaymentGateway` for local/tests, and a `StripePaymentGateway` that charges Stripe Connect accounts: destination charges by default (the platform is the merchant of record), or `chargeMode: 'direct'` (the seller's own account is, and the platform may take only an application fee). Checkout can collect a shipping address with fixed shipping rates and a phone number; webhooks (including those from connected accounts, signed with `connectWebhookSecret`) carry the connected account, the buyer and the shipping address. `ConnectOnboarding` + `FakeConnectOnboarding` / `StripeConnectOnboarding` for Express account KYC (refresh/return URLs). Refunds reverse the application fee by default. No Nest, no `stripe` SDK dependency — the consuming app passes a Stripe-shaped client in.
- **`packages/social`** → `@bubltec/mycota-social` — `SocialPublisher` port, a capability map that is honest about what each official API can actually do (TikTok is draft-only until partnership approval; Instagram Stories are not claimed), a `SocialPublisherRegistry` for fan-out, plus Meta / TikTok / X adapters over injected `fetch`. Connections are `meta` | `tiktok` | `x`: Facebook Login for Business lists Pages + linked Instagram via `/me/accounts`; Instagram and Facebook Page are opted in separately. Instagram Login and Threads are separate OAuth products. `insights()` reads native Graph / X public metrics after publish.
- **`packages/media`** → `@bubltec/mycota-media` — `MediaStore` port, `FakeMediaStore` for local/tests, `S3MediaStore` over an injected object-store client. Public objects use a CDN/base URL; private objects use signed GET. No AWS SDK dependency.
- **`packages/jobs`** → `@bubltec/mycota-jobs` — `JobScheduler` port for delayed work (campaign beats days out). `FakeJobScheduler.processDue` locally; `EventBridgeJobScheduler` uses Scheduler `at()` in production — SQS delay is 15 minutes and is the wrong primitive.
- **`packages/tokens`** → `@bubltec/mycota-tokens` — `TokenVault` for OAuth access/refresh tokens. Refreshes before expiry, marks `needs_reauth` when refresh fails. `EncryptedTokenStore` + `AesGcmSecretBox` at rest. Meta / TikTok / X refreshers over injected `fetch`. Generic `provider` string — not coupled to `@bubltec/mycota-social`.
- **`packages/postgres`** → `@bubltec/mycota-postgres` — `SqlDatabase` over an injected `pg.Pool` (no `pg` dependency here). Nested `transaction` joins the open transaction. `applyMigrations` + `VECTOR_EXTENSION`. Product tables stay in the consuming app. Local Docker / RDS are the same adapter — there is no in-memory SQL fake.
- **`packages/mail`** → `@bubltec/mycota-mail` — `Mailer` port, `FakeMailer` for local/tests, `SesMailer` over an injected SES-shaped client. Non-prod stages prefix subjects with `[stage]`. No AWS SDK dependency.
- **`packages/sms`** → `@bubltec/mycota-sms` — `SmsSender` port, `FakeSmsSender` for local/tests, `SnsSmsSender` over an injected SNS-shaped client. Numbers are normalized to E.164. No AWS SDK dependency.

## Timeouts and retries

Every outbound call has a timeout and, where it is safe, a retry. Defaults work out of the box; the settings below tune them.

| Calls | Default | Tune with |
| --- | --- | --- |
| Social, token-refresh `fetch` (`social`, `tokens`) | `ky`: 10s per attempt, 30s total, 2 retries with jitter on network errors, timeouts and 408/429/5xx. Only idempotent methods retry, so a POST (publishing a post, rotating a refresh token) never repeats. | Inject your own `fetch` to replace it. |
| SES and Bedrock (`auth`) | 3 attempts, 3s connect, 10s request (Bedrock 30s) | `config.network.aws` (`maxAttempts`, `connectionTimeoutMs`, `requestTimeoutMs`, `bedrockRequestTimeoutMs`) |
| SSM (`config`) | same as above | `aws` on `SsmConfigOptions`, `CloneSsmNamespaceOptions`, `DeleteSsmNamespaceOptions` |
| DynamoDB (`dynamo`) | same as above | `DynamoModule.forRoot({ aws })` |
| GitHub, Google, Facebook, Microsoft, Apple sign-in (`auth`) | 10s per request; the profile GET retries twice; the single-use code exchange never retries | `config.network.oauth` (`timeoutMs`, `retries`) |
| Brave search, homepage fetch (`auth`) | 5s per attempt; search retries twice, homepage once | not configurable |
| Stripe (`payments`) | none until the app opts in | `new Stripe(key, stripeClientOptions({ timeoutMs, maxNetworkRetries }))`; defaults 20s and 2 retries |

The mail, SMS, media and jobs adapters take injected clients, so their timeouts are whatever the app configures on those clients.

## Sign-in methods (`@bubltec/mycota-auth`)

| Method | Routes | Enabled by |
| --- | --- | --- |
| GitHub, Google | `GET /auth/{github,google}` + `/callback` | `config.github` / `config.google` |
| Apple | `GET /auth/apple`, **`POST`** `/auth/apple/callback` | `config.apple` |
| Facebook | `GET /auth/facebook` + `/callback` | `config.facebook` |
| Microsoft | `GET /auth/microsoft` + `/callback` | `config.microsoft` |
| Email or phone code | `POST /auth/otp/request`, `POST /auth/otp/confirm` | email always; phone when `smsSender` is passed |
| Anonymous email code | `POST /auth/anon-email/{request,confirm}` | `config.anonymousEmail.pepper` |
| Work email (verification) | `POST /auth/email/{request,confirm}` | always |

`GET /auth/providers` returns which are on, so a UI can render only working buttons. A provider
whose config block is absent has no strategy registered and its routes return 404.

```ts
MycotaAuthModule.forRootAsync({
  useFactory: () => buildMycotaAuthConfigFromSsm({ namespace: 'myapp', env }),
  // Optional. Email defaults to SES; phone is off unless an SmsSender is given.
  smsSender: () => new SnsSmsSender(snsClient),
});
```

**One-time codes** (`/auth/otp/*`) are passwordless sign-in *and* sign-up: the same flow for new and returning users, so
neither response reveals whether an account exists. Unlike the work-email flow they accept any address (no domain screening,
no classification). Codes are 6 digits, valid 10 minutes, stored as an HMAC (keyed with `jwtSecret`), single use, limited
to 5 guesses (counted atomically, so parallel guesses can't dodge it), one send per minute and 5 per hour per address.
Per-IP limits are the edge's job (WAF). Pending codes are `OTP#...` items in the users table with a `ttl` attribute;
enable DynamoDB TTL on `ttl` to have them cleaned up. Email OTP users share the `email` provider key with the work-email flow.
`GET /auth/otp/test-code` (for E2E) answers only when `config.stage` is explicitly `local` or `test`; an unset stage is treated as production.

**Fastify.** Passport calls `res.setHeader`/`res.end`, which Fastify replies lack, so every OAuth login route 500s until you call
`enablePassportFastifyCompat(app.getHttpAdapter().getInstance())` after registering `@fastify/cookie`. Apple posts its callback
as a form (`response_mode=form_post`); Nest's Fastify adapter already parses urlencoded bodies, so
registering `@fastify/formbody` as well fails with "content type parser already present".

**Anonymous email** (`/auth/anon-email/*`) is the same emailed-code flow, for apps that want an account
that holds no personal data. The address is used to send the code and is then gone: the pending code,
its rate-limit counters, and the account are all keyed by `v1:` + `HMAC-SHA256(pepper, email)`. The user
record has no `email`, `provider: 'anon_email'`, and display name "Anonymous". The email travels in the
request body, never the URL, and mail-provider errors (which often quote the recipient) are logged by
class only and returned as a generic 502.

What this does and does not promise:

- **A leaked database does not reveal addresses, and cannot be tested against guesses without the pepper.**
  It has to be a *keyed* hash: addresses are guessable, so a plain SHA-256 could be reversed by trying
  likely ones. Keep the pepper (32+ characters, different from `jwtSecret`) in a secret store, apart from
  the database (`anon-email-pepper` in SSM). Whoever holds both can confirm a guess for a *known* address,
  though not list the addresses.
- **The address is still visible while the code is sent** (in memory, to your mail provider such as SES,
  and in that provider's own logs or event streams if you enable them with recipients).
- **There is no recovery.** Nobody, including you, can email the user later. Lose the inbox and the account
  is unreachable; whoever controls the inbox controls the account.
- **Never lose or change the pepper.** Every account is addressed by hashes made with it. The `v1:` prefix
  leaves room for a rotation scheme, which does not exist yet.
- This is a separate identity from the ordinary `email` provider: the same person using both has two accounts.

New SSM keys (`buildMycotaAuthConfigFromSsm`): `apple-{client-id,team-id,key-id,private-key,callback-url}`,
`facebook-{client-id,client-secret,callback-url}`, `microsoft-{client-id,client-secret,callback-url,tenant}`, `anon-email-pepper`, `app-name`.
Accounts are keyed per provider; the same person signing in with two providers gets two users (no linking yet).

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
import {
  grantSsmConfigRead,
  EphemeralConfig,
  MediaBucket,
  JobQueue,
  PostgresInstance,
  SesDomain,
  GithubActionsDeployRole,
} from '@bubltec/mycota-cdk';

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

// Private S3 + CloudFront OAC for posters / Reels / print PDFs.
const media = new MediaBucket(this, 'Media', { namespace: 'myapp', env: 'dev' });
media.grantReadWrite(myLambda);

// SQS worker + EventBridge Scheduler group. Campaign beats days out use
// Scheduler `at()`, not SQS DelaySeconds (15 min cap).
const jobs = new JobQueue(this, 'Jobs', { namespace: 'myapp', env: 'dev' });
jobs.grantSchedule(myLambda);
jobs.grantConsume(myWorker);

// RDS Postgres 16. The app brings the VPC. pgvector is a migration
// (`VECTOR_EXTENSION`), not a CloudFormation property.
const db = new PostgresInstance(this, 'Db', { namespace: 'myapp', env: 'dev', vpc });
db.allowDefaultPortFrom(myLambda);
db.grantSecretRead(myLambda);

// Verified SES domain. App brings the hosted zone (usually a product subdomain).
const email = new SesDomain(this, 'Email', { hostedZone });
email.grantSendEmail(myLambda);

// GitHub Actions OIDC role for `cdk deploy`. Trusts `main` plus the
// `development` and `production` GitHub Environments by default.
const ci = new GithubActionsDeployRole(this, 'Gha', {
  repository: 'acme/myapp',
  roleName: 'myapp-gha-deploy',
});
```

`aws-cdk-lib`/`constructs` are peer dependencies, not bundled — a consuming
project supplies its own pinned CDK version, avoiding the "two copies of
constructs" jsii error that comes from a transitive dependency shipping its
own copy.

## Status

Published to the public npm registry under the `@bubltec` scope:
`@bubltec/mycota-config`, `@bubltec/mycota-dynamo`, `@bubltec/mycota-auth`,
`@bubltec/mycota-professional-verification`, `@bubltec/mycota-cdk`,
`@bubltec/mycota-payments`, `@bubltec/mycota-social`, `@bubltec/mycota-media`,
`@bubltec/mycota-jobs`, `@bubltec/mycota-tokens`, `@bubltec/mycota-postgres`, `@bubltec/mycota-mail`, `@bubltec/mycota-sms`. All packages version in
lockstep. The checked-in `version` field in each package.json is a permanent
placeholder (`0.0.0`) — it's never authoritative; CI computes the real version
fresh at publish time from git tags.

Every relevant push to `main` (`.github/workflows/ci.yml`) publishes to npm.
Real semver releases also get a `vX.Y.Z` git tag and a GitHub Release. Bump
level is chosen automatically:

- **`feat:` PR/commit** → minor bump (e.g. `0.1.0` → `0.2.0`)
- **`fix:` PR/commit** → patch bump
- **everything else** → patch bump
- **override** with `#major`, `#minor`, or `#patch` in the PR title (squash-merge
  subject); use `#next` to publish a rolling prerelease to the `next` dist-tag
  only (no git tag, no GitHub Release)

To cut a release from current `main` without a new commit: Actions → CI → **Run
workflow** → choose the bump level.

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

The framework itself is **not** bundled. `@bubltec/mycota-auth`,
`@bubltec/mycota-dynamo` and `@bubltec/mycota-professional-verification` declare
NestJS 12 (`@nestjs/common`, `@nestjs/core`, `@nestjs/jwt`, `@nestjs/passport`),
`class-validator` ^0.15, `class-transformer`, `passport`, `reflect-metadata` and `rxjs`
as **peer dependencies**, so your app owns exactly one copy. Two copies would break DI
and make `class-validator` decorators register into a store your `ValidationPipe`
never reads. pnpm and npm 7+ install peers automatically; if you pin your own
versions, keep them within the ranges above. Built and tested on Node 26 with
TypeScript 7 (`"types": ["node"]` must be set explicitly in your tsconfig under TS 7).

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
