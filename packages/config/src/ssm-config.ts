import {
  GetParametersByPathCommand,
  PutParameterCommand,
  DeleteParametersCommand,
  SSMClient,
} from '@aws-sdk/client-ssm';

export interface SsmConfigOptions {
  /** Top-level SSM prefix, e.g. 'btfp'. */
  namespace: string;
  /** Any string — 'dev', 'prod', 'pr-123', a branch name. Not a fixed enum, so ephemeral stacks need no code changes. */
  env: string;
  region?: string;
  /** Also merge in /{namespace}/shared/*, env-specific wins on key collision. Default true. */
  includeShared?: boolean;
}

interface SsmParam {
  name: string;
  value: string;
}

/** SSM's DeleteParameters caps at 10 names per call. */
const DELETE_BATCH_SIZE = 10;

function resolveRegion(region?: string): string {
  return region ?? process.env.AWS_REGION ?? 'us-east-1';
}

function leafName(parameterName: string): string {
  return parameterName.split('/').pop() ?? parameterName;
}

function toLeafMap(params: SsmParam[]): Record<string, string> {
  return Object.fromEntries(params.map((p) => [leafName(p.name), p.value]));
}

/**
 * Lists every parameter under `path`, decrypted. Returns [] for a path with
 * no parameters at all — GetParametersByPath never throws for an empty
 * result, unlike GetParameter for a single missing name — which is exactly
 * what makes an unprovisioned/ephemeral environment degrade gracefully
 * instead of failing to boot.
 */
async function listParametersUnderPath(client: SSMClient, path: string): Promise<SsmParam[]> {
  const results: SsmParam[] = [];
  let nextToken: string | undefined;
  do {
    const response = await client.send(
      new GetParametersByPathCommand({
        Path: path,
        Recursive: true,
        WithDecryption: true,
        NextToken: nextToken,
      }),
    );
    for (const param of response.Parameters ?? []) {
      if (param.Name && param.Value !== undefined) {
        results.push({ name: param.Name, value: param.Value });
      }
    }
    nextToken = response.NextToken;
  } while (nextToken);
  return results;
}

/**
 * Loads config for one namespace/env, merging /{namespace}/shared/* first
 * and then /{namespace}/{env}/* on top (env wins on collision). Returns {}
 * for an environment that hasn't been provisioned yet — never throws for
 * that case — so a brand-new ephemeral stack still boots (degraded/
 * placeholder) instead of crashing.
 */
export async function loadSsmConfig(options: SsmConfigOptions): Promise<Record<string, string>> {
  const client = new SSMClient({ region: resolveRegion(options.region) });
  const merged: Record<string, string> = {};

  if (options.includeShared ?? true) {
    Object.assign(
      merged,
      toLeafMap(await listParametersUnderPath(client, `/${options.namespace}/shared/`)),
    );
  }
  Object.assign(
    merged,
    toLeafMap(await listParametersUnderPath(client, `/${options.namespace}/${options.env}/`)),
  );
  return merged;
}

/**
 * Writes each non-empty value to /{namespace}/{env}/{key} as a SecureString.
 * Empty/undefined values are skipped (mirrors "don't push a placeholder").
 * Returns the parameter names actually written.
 */
export async function pushSsmConfig(
  options: SsmConfigOptions,
  values: Record<string, string | undefined>,
): Promise<string[]> {
  const client = new SSMClient({ region: resolveRegion(options.region) });
  const written: string[] = [];

  for (const [key, value] of Object.entries(values)) {
    if (!value) continue;
    const name = `/${options.namespace}/${options.env}/${key}`;
    await client.send(
      new PutParameterCommand({ Name: name, Value: value, Type: 'SecureString', Overwrite: true }),
    );
    written.push(name);
  }
  return written;
}

export interface CloneSsmNamespaceOptions {
  namespace: string;
  sourceEnv: string;
  targetEnv: string;
  region?: string;
}

/**
 * The ephemeral-stack bootstrap primitive: copies every parameter from
 * /{namespace}/{sourceEnv}/* to /{namespace}/{targetEnv}/* — e.g. spin up
 * "pr-123" pre-populated from "dev"'s values. Idempotent (Overwrite: true).
 */
export async function cloneSsmNamespace(options: CloneSsmNamespaceOptions): Promise<string[]> {
  const client = new SSMClient({ region: resolveRegion(options.region) });
  const sourceParams = await listParametersUnderPath(
    client,
    `/${options.namespace}/${options.sourceEnv}/`,
  );

  const written: string[] = [];
  for (const param of sourceParams) {
    const targetName = `/${options.namespace}/${options.targetEnv}/${leafName(param.name)}`;
    await client.send(
      new PutParameterCommand({
        Name: targetName,
        Value: param.value,
        Type: 'SecureString',
        Overwrite: true,
      }),
    );
    written.push(targetName);
  }
  return written;
}

export interface DeleteSsmNamespaceOptions {
  namespace: string;
  env: string;
  region?: string;
}

/**
 * The ephemeral-stack teardown primitive: deletes every parameter under
 * /{namespace}/{env}/* — call when a PR closes / a preview stack is
 * destroyed, so its secrets don't linger indefinitely.
 *
 * Confirmed empirically: SSM's GetParametersByPath can lag a few seconds
 * behind a delete — a loadSsmConfig call immediately after this resolves
 * can still show the just-deleted values before catching up. Don't chain
 * "delete, then immediately verify empty" in a script without a short wait;
 * a teardown pipeline that deletes and moves on (the normal case) is fine.
 */
export async function deleteSsmNamespace(options: DeleteSsmNamespaceOptions): Promise<string[]> {
  const client = new SSMClient({ region: resolveRegion(options.region) });
  const path = `/${options.namespace}/${options.env}/`;
  const params = await listParametersUnderPath(client, path);
  if (params.length === 0) return [];

  const names = params.map((p) => p.name);
  const deleted: string[] = [];
  for (let i = 0; i < names.length; i += DELETE_BATCH_SIZE) {
    const batch = names.slice(i, i + DELETE_BATCH_SIZE);
    await client.send(new DeleteParametersCommand({ Names: batch }));
    deleted.push(...batch);
  }
  return deleted;
}
