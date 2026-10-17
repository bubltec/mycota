import { Global, Module, type DynamicModule } from '@nestjs/common';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { awsClientDefaults, type AwsClientSettings } from './aws-client-defaults.js';
import { DYNAMO_DOC_CLIENT } from './dynamo.constants.js';

export interface DynamoModuleOptions {
  /** Timeout and retry settings for the DynamoDB client. */
  aws?: AwsClientSettings;
}

function createDocClient(options: DynamoModuleOptions = {}): DynamoDBDocumentClient {
  const endpoint = process.env.DYNAMODB_ENDPOINT;
  const client = new DynamoDBClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
    ...awsClientDefaults(options.aws),
    ...(endpoint
      ? { endpoint, credentials: { accessKeyId: 'local', secretAccessKey: 'local' } }
      : {}),
  });
  return DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });
}

/**
 * Points at DynamoDB Local when DYNAMODB_ENDPOINT is set (local dev), or real
 * DynamoDB via the Lambda execution role otherwise. Import `DynamoModule` for the
 * defaults, or `DynamoModule.forRoot({ aws })` to tune timeouts and retries.
 */
@Global()
@Module({
  providers: [{ provide: DYNAMO_DOC_CLIENT, useFactory: () => createDocClient() }],
  exports: [DYNAMO_DOC_CLIENT],
})
export class DynamoModule {
  static forRoot(options: DynamoModuleOptions = {}): DynamicModule {
    return {
      module: DynamoModule,
      global: true,
      providers: [{ provide: DYNAMO_DOC_CLIENT, useFactory: () => createDocClient(options) }],
      exports: [DYNAMO_DOC_CLIENT],
    };
  }
}
