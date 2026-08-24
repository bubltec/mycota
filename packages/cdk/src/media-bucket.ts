import { RemovalPolicy } from 'aws-cdk-lib';
import { Distribution, ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { type IGrantable, type Grant } from 'aws-cdk-lib/aws-iam';
import { BlockPublicAccess, Bucket, BucketEncryption, HttpMethods } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface MediaBucketProps {
  /** Top-level prefix, e.g. 'sloth' — used in bucket name suffixing via CDK. */
  namespace: string;
  /** Any string — 'dev', 'prod', 'pr-123'. */
  env: string;
  /**
   * Put a CloudFront distribution in front of the bucket (default true).
   * Public MediaStore objects use the distribution domain; private objects
   * still go through signed S3 GETs.
   */
  cloudFront?: boolean;
}

/**
 * Private media bucket for posters, Reels, merch shots, print PDFs. Never
 * a public-read bucket — CloudFront (OAC) is the public path.
 */
export class MediaBucket extends Construct {
  readonly bucket: Bucket;
  readonly distribution?: Distribution;

  constructor(scope: Construct, id: string, props: MediaBucketProps) {
    super(scope, id);

    this.bucket = new Bucket(this, 'Bucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
      cors: [
        {
          allowedMethods: [HttpMethods.GET, HttpMethods.PUT, HttpMethods.HEAD],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
    });

    if (props.cloudFront ?? true) {
      this.distribution = new Distribution(this, 'Cdn', {
        comment: `${props.namespace}/${props.env} media`,
        defaultBehavior: {
          origin: S3BucketOrigin.withOriginAccessControl(this.bucket),
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
      });
    }
  }

  /** Base URL for public objects. Signed GETs still come from the S3 client. */
  get publicBaseUrl(): string {
    if (this.distribution) return `https://${this.distribution.distributionDomainName}`;
    return `https://${this.bucket.bucketRegionalDomainName}`;
  }

  grantReadWrite(grantee: IGrantable): Grant {
    return this.bucket.grantReadWrite(grantee);
  }
}
