# @bubltec/mycota-cdk

CDK constructs for mycota: SSM config grants and ephemeral bootstrap, plus
a private `MediaBucket` (S3 + CloudFront OAC), a `JobQueue` (SQS + DLQ +
EventBridge Scheduler group), and a `PostgresInstance` (RDS Postgres 16).

`aws-cdk-lib`/`constructs` are **peer dependencies**, not bundled — bring
your own pinned CDK version. Installing this package doesn't pull in a
second copy of either (which would otherwise risk the "two copies of
constructs" jsii error).

```bash
pnpm add @bubltec/mycota-cdk aws-cdk-lib constructs
```

## `grantSsmConfigRead(grantee, options)`

Grants read access to `/{namespace}/{env}/*` (and `/{namespace}/shared/*`
by default) on any `IGrantable` — the generalized version of a single
`ssm.StringParameter...grantRead(handler)` call a project would otherwise
hand-write per secret. Call it once on whatever role your Lambda/ECS task
already has; `@bubltec/mycota-config`'s `loadSsmConfig` running inside that
compute is what actually reads the values at runtime.

```ts
import { grantSsmConfigRead } from '@bubltec/mycota-cdk';

grantSsmConfigRead(myLambda, { namespace: 'myapp', env: 'dev' });

// Omit the /shared/* grant if this role genuinely never needs it:
grantSsmConfigRead(myLambda, { namespace: 'myapp', env: 'dev', includeShared: false });
```

| Option | Type | Default | |
| --- | --- | --- | --- |
| `namespace` | `string` | — | Top-level SSM prefix, e.g. `'myapp'`. |
| `env` | `string` | — | Any string — `'dev'`, `'prod'`, `'pr-123'`. |
| `includeShared` | `boolean` | `true` | Also grant `/{namespace}/shared/*`. |

## `EphemeralConfig` construct

Bootstraps an ephemeral stack's SSM config on creation by cloning it from a
template environment, and tears it down when the stack is destroyed —
closing the ephemeral-stack loop at the infra layer, not just the runtime
layer (`cloneSsmNamespace`/`deleteSsmNamespace` still have to be called by
*something*; this is that something, wired into CloudFormation's own
create/delete lifecycle via a Lambda-backed custom resource).

```ts
import { EphemeralConfig } from '@bubltec/mycota-cdk';

new EphemeralConfig(this, 'Config', {
  namespace: 'myapp',
  sourceEnv: 'dev',
  targetEnv: 'pr-123',
});
```

| Prop | Type | | |
| --- | --- | --- | --- |
| `namespace` | `string` | Top-level SSM prefix, e.g. `'myapp'`. |
| `sourceEnv` | `string` | The environment to clone config *from* — e.g. `'dev'`. |
| `targetEnv` | `string` | The ephemeral environment being bootstrapped — e.g. `'pr-123'`. |

**Create** clones `sourceEnv` → `targetEnv`. **Delete** removes
`targetEnv`'s parameters. **Update** is a deliberate no-op — re-cloning on
every stack update would silently overwrite config someone hand-tweaked
for this one ephemeral environment after it was created. Bootstrap once,
clean up once.

The handler's own execution role only gets exactly what it needs: read on
`sourceEnv`, read+write+delete on `targetEnv` — scoped per-instance, not a
blanket grant across the whole namespace.

## `MediaBucket` construct

Private S3 bucket (BlockPublicAccess ALL) with an optional CloudFront
distribution using origin access control. Public `MediaStore` objects use
the distribution domain; private objects still go through signed S3 GETs.
Never a public-read bucket.

```ts
import { MediaBucket } from '@bubltec/mycota-cdk';

const media = new MediaBucket(this, 'Media', { namespace: 'myapp', env: 'dev' });
media.grantReadWrite(myLambda);
// media.publicBaseUrl → https://xxxx.cloudfront.net
```

## `JobQueue` construct

SQS queue + DLQ + EventBridge Scheduler group + a role Scheduler assumes to
`SendMessage`. Delayed work days out (campaign beats) uses Scheduler `at()`,
not SQS `DelaySeconds` (15 minute cap). Runtime counterpart:
`@bubltec/mycota-jobs` `EventBridgeJobScheduler`.

```ts
import { JobQueue } from '@bubltec/mycota-cdk';

const jobs = new JobQueue(this, 'Jobs', { namespace: 'myapp', env: 'dev' });
jobs.grantSchedule(myApi);
jobs.grantConsume(myWorker);
```

## `PostgresInstance` construct

RDS Postgres 16 in private subnets. The consuming app supplies the `IVpc`.
pgvector is enabled by `@bubltec/mycota-postgres` `VECTOR_EXTENSION` at
migrate time, not by this construct. Local boot is Docker.

```ts
import { PostgresInstance } from '@bubltec/mycota-cdk';

const db = new PostgresInstance(this, 'Db', { namespace: 'myapp', env: 'dev', vpc });
db.allowDefaultPortFrom(myApi);
db.grantSecretRead(myApi);
```

## Testing this package locally

`pnpm test` builds first (`pretest` runs `pnpm run build`, since the
Lambda asset has to exist on disk before CDK can synth a construct that
references it via `Code.fromAsset`) — no manual build step needed before
running tests.
