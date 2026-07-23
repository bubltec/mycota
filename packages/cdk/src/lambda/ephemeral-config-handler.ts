import type { CdkCustomResourceEvent, CdkCustomResourceResponse } from 'aws-lambda';
import { cloneSsmNamespace, deleteSsmNamespace } from '@mycota/config';

interface EphemeralConfigResourceProperties {
  Namespace: string;
  SourceEnv: string;
  TargetEnv: string;
}

/**
 * The CDK Provider-framework "onEvent" handler behind EphemeralConfig.
 * Create clones sourceEnv -> targetEnv; Delete removes targetEnv's
 * parameters. Update is deliberately a no-op — see ephemeral-config.ts for
 * why (don't silently overwrite a hand-tweaked ephemeral environment).
 */
export async function handler(event: CdkCustomResourceEvent): Promise<CdkCustomResourceResponse> {
  const props = event.ResourceProperties as unknown as EphemeralConfigResourceProperties;
  const physicalResourceId = `${props.Namespace}/${props.TargetEnv}`;

  if (event.RequestType === 'Create') {
    const written = await cloneSsmNamespace({
      namespace: props.Namespace,
      sourceEnv: props.SourceEnv,
      targetEnv: props.TargetEnv,
    });
    return { PhysicalResourceId: physicalResourceId, Data: { ClonedParameterCount: written.length } };
  }

  if (event.RequestType === 'Delete') {
    const deleted = await deleteSsmNamespace({ namespace: props.Namespace, env: props.TargetEnv });
    return { PhysicalResourceId: physicalResourceId, Data: { DeletedParameterCount: deleted.length } };
  }

  // Update
  return { PhysicalResourceId: physicalResourceId };
}
