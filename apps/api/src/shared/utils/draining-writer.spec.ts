// How a streamed response waits for the client, and what happens when the client leaves.
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readdirSync, readFileSync } from 'node:fs';
import http, { type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import compression from 'compression';
import express from 'express';
import { describe, expect, it } from 'vitest';
import { drainingWriter } from './draining-writer';

/** A response whose buffer is full whenever `full` is set. */
class FakeResponse extends EventEmitter {
  destroyed = false;
  full = false;
  readonly written: string[] = [];
  write(chunk: string): boolean {
    this.written.push(chunk);
    return !this.full;
  }
}

const fake = (): { res: FakeResponse; asResponse: ServerResponse } => {
  const res = new FakeResponse();
  return { res, asResponse: res as unknown as ServerResponse };
};

/** Whether `promise` has settled after the queued callbacks have run. */
const settled = async (promise: Promise<unknown>): Promise<boolean> => {
  let done = false;
  void promise.then(
    () => (done = true),
    () => (done = true),
  );
  await new Promise((resolve) => setImmediate(resolve));
  return done;
};

describe('drainingWriter', () => {
  it('writes straight through while the response takes more', async () => {
    const { res, asResponse } = fake();
    const write = drainingWriter(asResponse);
    expect(await write('a\n')).toBe(true);
    expect(await write('b\n')).toBe(true);
    expect(res.written).toEqual(['a\n', 'b\n']);
  });

  it('waits for drain under backpressure, with one listener for every wait', async () => {
    const { res, asResponse } = fake();
    const write = drainingWriter(asResponse);
    expect(res.listenerCount('drain')).toBe(1);
    res.full = true;
    for (let i = 0; i < 20; i += 1) {
      const waiting = write(`${i}\n`);
      expect(await settled(waiting)).toBe(false);
      res.emit('drain');
      expect(await waiting).toBe(true);
    }
    expect(res.listenerCount('drain')).toBe(1);
  });

  it('stops waiting when the client leaves, and writes nothing after', async () => {
    const { res, asResponse } = fake();
    const write = drainingWriter(asResponse);
    res.full = true;
    const waiting = write('a\n');
    res.destroyed = true;
    res.emit('close');
    expect(await settled(waiting)).toBe(true);
    expect(await waiting).toBe(false);
    expect(await write('b\n')).toBe(false);
    expect(res.written).toEqual(['a\n']);
  });

  it('writes nothing to a response whose client left before the writer was made', async () => {
    const { res, asResponse } = fake();
    res.destroyed = true;
    const write = drainingWriter(asResponse);
    expect(await write('a\n')).toBe(false);
    expect(res.written).toEqual([]);
  });

  it('fails a waiting write, and every later one, when the response errors', async () => {
    const { res, asResponse } = fake();
    const write = drainingWriter(asResponse);
    res.full = true;
    const waiting = write('a\n');
    const failure = new Error('socket gone wrong');
    res.emit('error', failure);
    await expect(waiting).rejects.toBe(failure);
    await expect(write('b\n')).rejects.toBe(failure);
  });
});

describe('a download the client abandons', () => {
  it.each([
    ['sent plain', false],
    ['compressed', true],
  ])('ends the export instead of leaving it waiting (%s)', async (_label, compressed) => {
    const cap = 1_000_000;
    let blocked!: () => void;
    const firstBackpressure = new Promise<void>((resolve) => (blocked = resolve));
    let stopped!: (outcome: { rows: number; open: boolean }) => void;
    const exportEnded = new Promise<{ rows: number; open: boolean }>(
      (resolve) => (stopped = resolve),
    );

    const app = express();
    if (compressed) app.use(compression({ threshold: 1024 }));
    app.get('/export.csv', (_req, res) => {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      const sent = res.write.bind(res) as (chunk: string) => boolean;
      res.write = ((chunk: string) => {
        const accepted = sent(chunk);
        if (!accepted) blocked();
        return accepted;
      }) as typeof res.write;
      const write = drainingWriter(res);
      void (async () => {
        let rows = 0;
        let open = true;
        // Random rows, so even compressed they fill the socket of a client that reads nothing.
        while (open && rows < cap) {
          open = await write(`${rows},${randomBytes(24).toString('hex')}\n`);
          if (open) rows += 1;
        }
        res.end();
        stopped({ rows, open });
      })();
    });

    const server = app.listen(0);
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const { port } = server.address() as AddressInfo;
      const client = http.get({
        port,
        path: '/export.csv',
        agent: false,
        headers: { 'Accept-Encoding': 'gzip' },
      });
      client.on('error', () => undefined);
      client.on('response', (incoming) => incoming.pause());
      await firstBackpressure;
      client.destroy();

      const outcome = await Promise.race([
        exportEnded,
        new Promise<'still waiting'>((resolve) =>
          setTimeout(() => resolve('still waiting'), 5_000),
        ),
      ]);
      expect(outcome).not.toBe('still waiting');
      const { rows, open } = outcome as { rows: number; open: boolean };
      expect(open).toBe(false);
      expect(rows).toBeLessThan(cap);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('the streamed exports', () => {
  it('wait for a response to drain through drainingWriter, never with `once` per wait', () => {
    // Behind the compression middleware, each `res.once('drain')` leaves its spent listener on
    // the zlib stream (see draining-writer.ts), and `events.once(res, 'drain')` does the same. A
    // raw socket (the clamd client) is not wrapped by the middleware, so it is not matched here.
    const src = join(dirname(fileURLToPath(import.meta.url)), '../..');
    const responseOnceDrain =
      /\b(res|response)\.once\(\s*['"`]drain['"`]|\bonce\(\s*(res|response)\s*,\s*['"`]drain['"`]/;
    const offenders: string[] = [];
    const visit = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) visit(path);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
          const code = readFileSync(path, 'utf8')
            .split('\n')
            .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
            .join('\n');
          if (responseOnceDrain.test(code)) offenders.push(relative(src, path));
        }
      }
    };
    visit(src);
    expect(offenders).toEqual([]);
  });
});
