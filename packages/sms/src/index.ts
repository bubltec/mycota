export type { SendSmsResult, SmsMessage, SmsSender, SnsSmsClient } from './ports.js';
export { toE164 } from './phone.js';
export { FakeSmsSender } from './fake.adapter.js';
export { SnsSmsSender, type SnsSmsSenderOptions } from './sns.adapter.js';
