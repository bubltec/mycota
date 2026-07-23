import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CustomResource, Duration } from 'aws-cdk-lib';
import { Code, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Provider } from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface EphemeralConfigProps {
  /** Top-level SSM prefix, e.g. 'myapp'. */
  namespace: string;
  /** The environment to clone config *from* — e.g. 'dev'. */
  sourceEnv: string;
  /** The ephemeral environment being bootstrapped — e.g. 'pr-123'. */
  targetEnv: string;
}

/**
 * Bootstraps an ephemeral stack's SSM config on creation by cloning it from
 * a template environment (`@mycota/config`'s `cloneSsmNamespace`), and
 * tears it down (`deleteSsmNamespace`) when the stack is destroyed —
 * closing the ephemeral-stack loop at the infra layer, not just the
 * runtime layer.
 *
 * Deliberately a no-op on stack updates: re-cloning every deploy would
 * silently overwrite config someone may have hand-tweaked for this specific
 * ephemeral environment after it was created. Bootstrap once, clean up
 * once — same "don't surprise-overwrite" philosophy as
 * `pushSsmConfig`/`cloneSsmNamespace` themselves being idempotent-but-only-
 * when-you-call-them, not automatic.
 */
export class EphemeralConfig extends Construct {
  constructor(scope: Construct, id: string, props: EphemeralConfigProps) {
    super(scope, id);

    const handlerFn = new LambdaFunction(this, 'Handler', {
      runtime: Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: Code.fromAsset(path.join(__dirname, '../lambda-dist')),
      timeout: Duration.seconds(30),
    });

    // Read on the source (to clone from), write+delete on the target (to
    // bootstrap and tear down) — not reusing grantSsmConfigRead, which is
    // deliberately read-only.
    handlerFn.addToRolePolicy(
      new PolicyStatement({
        actions: ['ssm:GetParametersByPath'],
        resources: [`arn:aws:ssm:*:*:parameter/${props.namespace}/${props.sourceEnv}/*`],
      }),
    );
    handlerFn.addToRolePolicy(
      new PolicyStatement({
        actions: ['ssm:GetParametersByPath', 'ssm:PutParameter', 'ssm:DeleteParameters'],
        resources: [`arn:aws:ssm:*:*:parameter/${props.namespace}/${props.targetEnv}/*`],
      }),
    );

    const provider = new Provider(this, 'Provider', { onEventHandler: handlerFn });

    new CustomResource(this, 'Resource', {
      serviceToken: provider.serviceToken,
      properties: {
        Namespace: props.namespace,
        SourceEnv: props.sourceEnv,
        TargetEnv: props.targetEnv,
      },
    });
  }
}
