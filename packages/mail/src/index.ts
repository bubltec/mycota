export type { Mailer, MailMessage, SendMailResult, SesClient } from './ports.js';
export { FakeMailer } from './fake.adapter.js';
export { SesMailer, type SesMailerOptions } from './ses.adapter.js';
