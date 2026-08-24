import type { MediaStore, ObjectBody, ObjectStoreClient, PutObjectInput, StoredObject } from './ports.js';

export interface S3MediaStoreOptions {
  /** e.g. https://media.example.com or https://bucket.s3.amazonaws.com */
  publicBaseUrl: string;
  defaultExpiresInSeconds?: number;
}

/**
 * S3 (or S3-compatible) adapter. Public keys are concatenated onto
 * `publicBaseUrl`; private keys go through the client's signed GET.
 */
export class S3MediaStore implements MediaStore {
  private readonly publicKeys = new Set<string>();

  constructor(
    private readonly client: ObjectStoreClient,
    private readonly options: S3MediaStoreOptions,
  ) {}

  async put(input: PutObjectInput): Promise<StoredObject> {
    if (!input.key) throw new Error('media key is required');
    await this.client.putObject({
      key: input.key,
      body: input.body,
      contentType: input.contentType,
      cacheControl: input.cacheControl,
    });
    if (input.visibility === 'public') this.publicKeys.add(input.key);
    else this.publicKeys.delete(input.key);
    return {
      key: input.key,
      url: await this.urlFor(input.key, input.visibility),
      contentType: input.contentType,
      sizeBytes: input.body.byteLength,
      visibility: input.visibility,
    };
  }

  async get(key: string): Promise<ObjectBody | undefined> {
    return this.client.getObject(key);
  }

  async delete(key: string): Promise<void> {
    this.publicKeys.delete(key);
    await this.client.deleteObject(key);
  }

  async url(key: string, expiresInSeconds?: number): Promise<string> {
    if (this.publicKeys.has(key)) return this.publicUrl(key);
    return this.client.getSignedUrl(key, expiresInSeconds ?? this.options.defaultExpiresInSeconds ?? 3600);
  }

  private publicUrl(key: string): string {
    return `${this.options.publicBaseUrl.replace(/\/$/, '')}/${key.replace(/^\//, '')}`;
  }

  private async urlFor(key: string, visibility: PutObjectInput['visibility']): Promise<string> {
    if (visibility === 'public') return this.publicUrl(key);
    return this.url(key);
  }
}
