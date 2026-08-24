import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import {
  InstanceClass,
  InstanceSize,
  InstanceType,
  type IConnectable,
  type IVpc,
  SubnetType,
} from 'aws-cdk-lib/aws-ec2';
import { type Grant, type IGrantable } from 'aws-cdk-lib/aws-iam';
import {
  Credentials,
  DatabaseInstance,
  DatabaseInstanceEngine,
  PostgresEngineVersion,
  StorageType,
} from 'aws-cdk-lib/aws-rds';
import type { ISecret } from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface PostgresInstanceProps {
  /** Top-level prefix, e.g. 'sloth' — used in the instance identifier. */
  namespace: string;
  /** Any string — 'dev', 'prod', 'pr-123'. */
  env: string;
  /** The app brings the VPC. RDS cannot invent one without locking you into NAT. */
  vpc: IVpc;
  /** Database name. Default is the namespace with non-alphanumerics stripped. */
  databaseName?: string;
  instanceType?: InstanceType;
}

/**
 * RDS Postgres 16 for product data (events, tickets, audience) and later
 * pgvector. The extension is created by `@bubltec/mycota-postgres`
 * `VECTOR_EXTENSION`, not this construct. Local boot is Docker, not LocalStack.
 */
export class PostgresInstance extends Construct {
  readonly instance: DatabaseInstance;
  readonly secret: ISecret;
  readonly databaseName: string;

  constructor(scope: Construct, id: string, props: PostgresInstanceProps) {
    super(scope, id);

    this.databaseName = props.databaseName ?? (props.namespace.replace(/[^a-zA-Z0-9]/g, '').slice(0, 63) || 'app');
    const prod = props.env === 'prod';
    const identifier = `${props.namespace}-${props.env}-pg`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 63);

    this.instance = new DatabaseInstance(this, 'Instance', {
      engine: DatabaseInstanceEngine.postgres({ version: PostgresEngineVersion.VER_16 }),
      vpc: props.vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      instanceType: props.instanceType ?? InstanceType.of(InstanceClass.T4G, InstanceSize.MICRO),
      credentials: Credentials.fromGeneratedSecret(this.databaseName),
      databaseName: this.databaseName,
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageType: StorageType.GP3,
      storageEncrypted: true,
      backupRetention: prod ? Duration.days(7) : Duration.days(1),
      deletionProtection: prod,
      removalPolicy: prod ? RemovalPolicy.RETAIN : RemovalPolicy.SNAPSHOT,
      instanceIdentifier: identifier,
    });

    const secret = this.instance.secret;
    if (!secret) throw new Error('PostgresInstance expected RDS to create a secret');
    this.secret = secret;
  }

  allowDefaultPortFrom(peer: IConnectable): void {
    this.instance.connections.allowDefaultPortFrom(peer);
  }

  grantSecretRead(grantee: IGrantable): Grant {
    return this.secret.grantRead(grantee);
  }
}
