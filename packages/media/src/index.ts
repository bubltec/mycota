export type { MediaStore, MediaVisibility, ObjectBody, ObjectStoreClient, PutObjectInput, StoredObject } from './ports.js';
export { FakeMediaStore } from './fake.adapter.js';
export { S3MediaStore, type S3MediaStoreOptions } from './s3.adapter.js';
