// The clamd client against a fake daemon on a loopback port: the wire format, the three replies,
// and every way the exchange can fail without a verdict. Nothing here needs ClamAV installed.
import { once } from 'node:events';
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { ClamdError, parseClamdReply, pingClamd, scanStreamWithClamd } from './clamd';

type Behaviour = 'scan' | 'hang' | 'error' | 'close' | 'early';

/**
 * Enough of clamd to exercise the client: `zPING` → `PONG`, `zINSTREAM` framed chunks until the
 * zero-length terminator, and a verdict decided by whether the bytes contain the EICAR marker.
 * The other behaviours are the failure modes a real daemon has.
 */
const fakeClamd = async (behaviour: Behaviour): Promise<{ server: Server; port: number }> => {
  const server = createServer((socket: Socket) => {
    let buffered = Buffer.alloc(0);
    let command: string | null = null;
    let body = '';
    let answered = false;
    const answer = (reply: string): void => {
      if (answered) return;
      answered = true;
      socket.end(reply);
    };
    socket.on('data', (chunk: Buffer) => {
      if (answered) return; // the client may still be sending after an early verdict
      buffered = Buffer.concat([buffered, chunk]);
      if (command === null) {
        const nul = buffered.indexOf(0);
        if (nul === -1) return;
        command = buffered.subarray(0, nul).toString('latin1');
        buffered = buffered.subarray(nul + 1);
        if (command === 'zPING') {
          answer('PONG\0');
          return;
        }
        if (behaviour === 'hang') return;
        if (behaviour === 'error') {
          answer('INSTREAM size limit exceeded. ERROR\0');
          return;
        }
        if (behaviour === 'close') {
          socket.destroy();
          return;
        }
      }
      if (behaviour === 'hang') return;
      while (buffered.length >= 4) {
        const length = buffered.readUInt32BE(0);
        if (length === 0) {
          answer(body.includes('EICAR') ? 'stream: Win.Test.EICAR_HDB-1 FOUND\0' : 'stream: OK\0');
          return;
        }
        if (buffered.length < 4 + length) return;
        body += buffered.subarray(4, 4 + length).toString('latin1');
        buffered = buffered.subarray(4 + length);
        // The daemon's size limit: it answers and closes mid-stream, while bytes are still coming.
        if (behaviour === 'early' && body.length > 1024) {
          answer('INSTREAM size limit exceeded. ERROR\0');
          return;
        }
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, port: (server.address() as AddressInfo).port };
};

const servers: Server[] = [];
const daemon = async (behaviour: Behaviour = 'scan') => {
  const { server, port } = await fakeClamd(behaviour);
  servers.push(server);
  return { host: '127.0.0.1', port, timeoutMs: 2_000 };
};

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((r) => server.close(r))));
});

describe('parseClamdReply', () => {
  it('reads the three shapes of reply', () => {
    expect(parseClamdReply('stream: OK\0')).toEqual({ verdict: 'clean' });
    expect(parseClamdReply('stream: Win.Test.EICAR_HDB-1 FOUND')).toEqual({
      verdict: 'infected',
      signature: 'Win.Test.EICAR_HDB-1',
    });
    expect(() => parseClamdReply('INSTREAM size limit exceeded. ERROR')).toThrow(ClamdError);
    expect(() => parseClamdReply('')).toThrow(/nothing/);
  });

  it('never mistakes a signature for a clean verdict', () => {
    expect(parseClamdReply('stream: Not.OK.Really FOUND')).toEqual({
      verdict: 'infected',
      signature: 'Not.OK.Really',
    });
  });
});

describe('pingClamd', () => {
  it('is true for a daemon that answers PONG and false for one that is not there', async () => {
    expect(await pingClamd(await daemon())).toBe(true);
    expect(await pingClamd({ host: '127.0.0.1', port: 1, timeoutMs: 500 })).toBe(false);
  });
});

describe('scanStreamWithClamd', () => {
  it('reports a clean file', async () => {
    const verdict = await scanStreamWithClamd(
      Readable.from([Buffer.from('hello world')]),
      await daemon(),
    );
    expect(verdict).toEqual({ verdict: 'clean' });
  });

  it('reports an infected file with the signature', async () => {
    const eicar = Buffer.from(
      'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
    );
    const verdict = await scanStreamWithClamd(Readable.from([eicar]), await daemon());
    expect(verdict).toEqual({ verdict: 'infected', signature: 'Win.Test.EICAR_HDB-1' });
  });

  it('frames a large stream in many chunks and still gets one verdict', async () => {
    // Bigger than any socket buffer, so the write path has to wait for drain at least once.
    const chunks = Array.from({ length: 64 }, () => Buffer.alloc(64 * 1024, 0x41));
    const verdict = await scanStreamWithClamd(Readable.from(chunks), await daemon());
    expect(verdict).toEqual({ verdict: 'clean' });
  });

  it('throws — never "clean" — when the daemon answers ERROR', async () => {
    await expect(
      scanStreamWithClamd(Readable.from([Buffer.from('x')]), await daemon('error')),
    ).rejects.toThrow(/size limit exceeded/);
  });

  it('throws when the daemon answers and closes while bytes are still being sent', async () => {
    const chunks = Array.from({ length: 32 }, () => Buffer.alloc(4096, 0x42));
    const stream = Readable.from(chunks);
    await expect(scanStreamWithClamd(stream, await daemon('early'))).rejects.toThrow(ClamdError);
    expect(stream.destroyed).toBe(true);
  });

  it('throws on timeout, on a connection closed without a verdict, and on an unreachable daemon', async () => {
    const hung = { ...(await daemon('hang')), timeoutMs: 200 };
    await expect(scanStreamWithClamd(Readable.from([Buffer.from('x')]), hung)).rejects.toThrow(
      /timed out/,
    );
    await expect(
      scanStreamWithClamd(Readable.from([Buffer.from('x')]), await daemon('close')),
    ).rejects.toThrow(/without a verdict/);
    await expect(
      scanStreamWithClamd(Readable.from([Buffer.from('x')]), {
        host: '127.0.0.1',
        port: 1,
        timeoutMs: 500,
      }),
    ).rejects.toThrow(ClamdError);
  });

  it('surfaces a stream that fails mid-read as a ClamdError and closes the connection', async () => {
    const broken = new Readable({
      read() {
        this.destroy(new Error('disk gone'));
      },
    });
    await expect(scanStreamWithClamd(broken, await daemon())).rejects.toThrow(/disk gone/);
  });
});
