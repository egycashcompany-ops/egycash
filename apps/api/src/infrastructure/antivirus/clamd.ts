// A clamd client — the ClamAV daemon's socket protocol, nothing more.
//
// The files service has had a `virusScan` extension point since Sprint 3.1 and a `scanStatus` on
// every file; what it never had was a scanner. This is one: `INSTREAM` over TCP to a `clamd`
// (the `clamav/clamav` image, port 3310), the bytes framed as the daemon wants them, and the one
// line it answers with parsed into a verdict. No SDK — the protocol is four commands and a NUL,
// and a dependency for that is a dependency to audit.
//
// Wire format (clamd(8)): every command is sent as `z<COMMAND>\0`, and the reply to a z-command
// is NUL-terminated. `INSTREAM` then takes the file as chunks of `<u32 big-endian length><bytes>`,
// ended by a zero-length chunk. The reply is one of
//     stream: OK
//     stream: <signature> FOUND
//     <something> ERROR              (e.g. "INSTREAM size limit exceeded. ERROR")
//
// Everything that is not a verdict — unreachable, timed out, closed early, ERROR — throws
// `ClamdError`. The processor turns a throw into "not scanned", never into "clean": a scanner that
// could not answer has said nothing about the file, and a file nobody has vouched for stays
// withheld (`pending`) rather than served on the strength of a network fault.
import { connect, type Socket } from 'node:net';
import { type Readable } from 'node:stream';

export interface ClamdOptions {
  host: string;
  port: number;
  /** Idle budget for the whole exchange — connecting, streaming, and waiting for the verdict. */
  timeoutMs: number;
}

export type ClamdVerdict = { verdict: 'clean' } | { verdict: 'infected'; signature: string };

export class ClamdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClamdError';
  }
}

const INSTREAM = Buffer.from('zINSTREAM\0', 'latin1');
const PING = Buffer.from('zPING\0', 'latin1');
const END_OF_STREAM = Buffer.alloc(4);

/** The daemon's one-line reply, as a verdict. Pure — the protocol tests run against this. */
export const parseClamdReply = (reply: string): ClamdVerdict => {
  const text = reply.replace(/\0+$/, '').trim();
  if (/^(?:stream: )?OK$/.test(text)) return { verdict: 'clean' };
  const found = /^(?:stream: )?(.+?) FOUND$/.exec(text);
  if (found !== null) return { verdict: 'infected', signature: found[1] as string };
  throw new ClamdError(`clamd replied "${text === '' ? '(nothing)' : text}"`);
};

/**
 * One exchange on one connection: connect, hand the socket to `talk`, and resolve with the
 * NUL-terminated reply. Every way the exchange can fail settles the same promise with a
 * `ClamdError`, and the socket is destroyed whichever way it went — a scan that ends never leaves
 * a connection open on the daemon.
 */
const exchange = (
  options: ClamdOptions,
  talk: (socket: Socket, failed: () => boolean) => Promise<void>,
): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    let settled = false;
    let reply = '';
    const socket = connect({ host: options.host, port: options.port });

    const settle = (outcome: { reply: string } | { error: ClamdError }): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if ('error' in outcome) reject(outcome.error);
      else resolve(outcome.reply);
    };

    socket.setTimeout(options.timeoutMs, () => {
      settle({
        error: new ClamdError(`clamd at ${options.host}:${String(options.port)} timed out`),
      });
    });
    socket.on('error', (error: Error) => {
      settle({
        error: new ClamdError(
          `clamd at ${options.host}:${String(options.port)} — ${error.message}`,
        ),
      });
    });
    socket.on('data', (chunk: Buffer) => {
      reply += chunk.toString('latin1');
      const end = reply.indexOf('\0');
      if (end !== -1) settle({ reply: reply.slice(0, end) });
    });
    socket.on('close', () => {
      settle({ error: new ClamdError('clamd closed the connection without a verdict') });
    });
    socket.once('connect', () => {
      talk(socket, () => settled).catch((error: unknown) => {
        settle({
          error:
            error instanceof ClamdError
              ? error
              : new ClamdError(error instanceof Error ? error.message : String(error)),
        });
      });
    });
  });

/** Waits for the socket to drain — or for the exchange to be over, whichever comes first. */
const drained = (socket: Socket): Promise<void> =>
  new Promise((resolve) => {
    const done = (): void => {
      socket.off('drain', done);
      socket.off('close', done);
      resolve();
    };
    socket.once('drain', done);
    socket.once('close', done);
  });

/** `PONG`, or not. Never throws — this is how boot LEARNS the scanner is down. */
export const pingClamd = async (options: ClamdOptions): Promise<boolean> => {
  try {
    const reply = await exchange(options, async (socket) => {
      socket.write(PING);
    });
    return reply.trim() === 'PONG';
  } catch {
    return false;
  }
};

/**
 * Scans a stream. Resolves with the verdict; throws `ClamdError` for anything that is not one.
 * The stream is destroyed on the way out so a failed exchange cannot pin a file handle open.
 */
export const scanStreamWithClamd = async (
  stream: Readable,
  options: ClamdOptions,
): Promise<ClamdVerdict> => {
  try {
    const reply = await exchange(options, async (socket, failed) => {
      socket.write(INSTREAM);
      for await (const piece of stream) {
        // The daemon may answer — and close — before the stream ends (its size limit, say). The
        // verdict is already settled by then; stop pushing bytes into a dead socket.
        if (failed()) return;
        const data: Buffer = Buffer.isBuffer(piece) ? piece : Buffer.from(piece as string);
        if (data.length === 0) continue;
        const header = Buffer.alloc(4);
        header.writeUInt32BE(data.length, 0);
        if (!socket.write(Buffer.concat([header, data]))) await drained(socket);
      }
      if (!failed()) socket.write(END_OF_STREAM);
    });
    return parseClamdReply(reply);
  } finally {
    stream.destroy();
  }
};
