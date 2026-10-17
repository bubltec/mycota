/** Resilience knobs for AWS SDK clients. Every field is optional; see the defaults below. */
export interface AwsClientSettings {
  /** Total attempts per call, including the first. Default 3. */
  maxAttempts?: number;
  /** Max time to open a connection. Default 3000. */
  connectionTimeoutMs?: number;
  /** Max time to wait for a response on an open connection. Default 10000. */
  requestTimeoutMs?: number;
}

/**
 * Settings to spread into an AWS SDK client config. The SDK retries 3 times by default but
 * has no request or connection timeout, so a hung socket would otherwise block forever.
 */
export function awsClientDefaults(settings: AwsClientSettings = {}, fallbackRequestTimeoutMs = 10_000) {
  return {
    maxAttempts: settings.maxAttempts ?? 3,
    requestHandler: {
      connectionTimeout: settings.connectionTimeoutMs ?? 3_000,
      requestTimeout: settings.requestTimeoutMs ?? fallbackRequestTimeoutMs,
    },
  };
}
