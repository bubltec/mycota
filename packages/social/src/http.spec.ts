import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultFetch } from './http.js';

let server: Server;

async function listen(handler: Parameters<typeof createServer>[1]): Promise<string> {
  server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(() => {
  server?.closeAllConnections();
  server?.close();
});

describe('createDefaultFetch', () => {
  it('retries a GET that gets a 503 and returns the eventual response', async () => {
    let hits = 0;
    const url = await listen((_req, res) => {
      hits += 1;
      res.statusCode = hits < 2 ? 503 : 200;
      res.end('ok');
    });

    const response = await createDefaultFetch()(url);

    expect(response.status).toBe(200);
    expect(hits).toBe(2);
  });

  it('does not retry a POST, and returns the error response instead of throwing', async () => {
    let hits = 0;
    const url = await listen((_req, res) => {
      hits += 1;
      res.statusCode = 503;
      res.end('down');
    });

    const response = await createDefaultFetch()(url, { method: 'POST', body: 'x' });

    expect(response.status).toBe(503);
    expect(await response.text()).toBe('down');
    expect(hits).toBe(1);
  });

  it('gives up on a hung upstream instead of waiting forever', async () => {
    const url = await listen(() => {
      // never respond
    });

    await expect(
      createDefaultFetch({ timeout: 100, totalTimeout: 1_000 })(url),
    ).rejects.toThrow();
  });
});
