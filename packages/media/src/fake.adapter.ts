import type { MediaStore, ObjectBody, PutObjectInput, StoredObject } from './ports.js';

interface Recorded {
  body: Uint8Array;
  contentType: string;
  visibility: PutObjectInput['visibility'];
  cacheControl?: string;
}

/**
 * Process-local media for tests and local boot. URLs are `memory://` so
 * nothing tries to fetch them over the network.
 */
export class FakeMediaStore implements MediaStore {
  private readonly objects = new Map<string, Recorded>();

  async put(input: PutObjectInput): Promise<StoredObject> {
    if (!input.key) throw new Error('media key is required');
    this.objects.set(input.key, {
      body: input.body,
      contentType: input.contentType,
      visibility: input.visibility,
      cacheControl: input.cacheControl,
    });
    return {
      key: input.key,
      url: this.memoryUrl(input.key, input.visibility),
      contentType: input.contentType,
      sizeBytes: input.body.byteLength,
      visibility: input.visibility,
    };
  }

  async get(key: string): Promise<ObjectBody | undefined> {
    const recorded = this.objects.get(key);
    if (!recorded) return undefined;
    return { body: recorded.body, contentType: recorded.contentType };
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async url(key: string, expiresInSeconds = 3600): Promise<string> {
    const recorded = this.objects.get(key);
    if (!recorded) throw new Error(`media ${key} not found`);
    return this.memoryUrl(key, recorded.visibility, expiresInSeconds);
  }

  private memoryUrl(key: string, visibility: PutObjectInput['visibility'], expiresInSeconds?: number): string {
    const exp = visibility === 'private' ? `?exp=${expiresInSeconds ?? 3600}` : '';
    return `memory://${key}${exp}`;
  }
}
