export type MediaVisibility = 'public' | 'private';

export interface PutObjectInput {
  key: string;
  body: Uint8Array;
  contentType: string;
  visibility: MediaVisibility;
  cacheControl?: string;
}

export interface StoredObject {
  key: string;
  /** Public URL, or a signed URL when the object is private. */
  url: string;
  contentType: string;
  sizeBytes: number;
  visibility: MediaVisibility;
}

export interface ObjectBody {
  body: Uint8Array;
  contentType: string;
}

/**
 * Byte store for posters, Reels, merch shots, print PDFs. Inner layers never
 * import S3 — they put a key and get a URL.
 */
export interface MediaStore {
  put(input: PutObjectInput): Promise<StoredObject>;
  get(key: string): Promise<ObjectBody | undefined>;
  delete(key: string): Promise<void>;
  /**
   * Public objects return the CDN/base URL. Private objects return a signed
   * GET that expires. `expiresInSeconds` is ignored for public objects.
   */
  url(key: string, expiresInSeconds?: number): Promise<string>;
}

/**
 * Narrow object-store surface so `@bubltec/mycota-media` does not take an AWS
 * SDK dependency. The consuming app constructs S3 (or a test double).
 */
export interface ObjectStoreClient {
  putObject(input: {
    key: string;
    body: Uint8Array;
    contentType: string;
    cacheControl?: string;
  }): Promise<void>;
  getObject(key: string): Promise<ObjectBody | undefined>;
  deleteObject(key: string): Promise<void>;
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string>;
}
