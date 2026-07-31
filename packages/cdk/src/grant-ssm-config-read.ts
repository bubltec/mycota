import { Grant, type IGrantable } from 'aws-cdk-lib/aws-iam';

export interface GrantSsmConfigReadOptions {
  /** Top-level SSM prefix, e.g. 'myapp' — matches @bubltec/mycota-config's SsmConfigOptions.namespace. */
  namespace: string;
  /** Any string — 'dev', 'prod', 'pr-123'. Matches @bubltec/mycota-config's SsmConfigOptions.env. */
  env: string;
  /** Also grant read on /{namespace}/shared/*. Default true — matches loadSsmConfig's own default. */
  includeShared?: boolean;
}

/**
 * Grants `grantee` read access to /{namespace}/{env}/* (and
 * /{namespace}/shared/* by default) — the generalized version of the
 * single-parameter `ssm.StringParameter...grantRead(handler)` a project
 * would otherwise hand-write per secret. Call once on whatever role your
 * Lambda/ECS task already has; `@bubltec/mycota-config`'s `loadSsmConfig` running
 * inside that compute is what actually reads the values at runtime.
 */
export function grantSsmConfigRead(grantee: IGrantable, options: GrantSsmConfigReadOptions): Grant {
  const paths = [`/${options.namespace}/${options.env}/*`];
  if (options.includeShared ?? true) {
    paths.push(`/${options.namespace}/shared/*`);
  }

  return Grant.addToPrincipal({
    grantee,
    actions: ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath'],
    resourceArns: paths.map((path) => `arn:aws:ssm:*:*:parameter${path}`),
  });
}
