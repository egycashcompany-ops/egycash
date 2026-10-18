// Writing a long response chunk by chunk (the CSV exports) without running ahead of the client.
//
// `res.write` returns false once the outgoing buffer is full, and the next chunk should wait for
// 'drain'. This writer adds ONE 'drain' listener for the whole response, before the first write,
// and that listener wakes whichever write is waiting. A new `once` listener per wait does not work
// once the response is compressed: the compression middleware replaces `res.on` so that 'drain'
// listeners go to its zlib stream, but it does not replace `res.removeListener`, so each spent
// `once` listener stays on that stream. One more is left per wait, until Node prints
// MaxListenersExceededWarning. `events.once(res, 'drain')` goes through `res.once` and leaks the
// same way. A listener added before the first write is held by the middleware and moved onto its
// stream when the stream is created.
//
// A client that leaves mid-download closes the response, and no 'drain' follows. The waiting write
// then resolves to false, and so does every later one, so the export can stop reading its cursor
// instead of waiting forever. An 'error' on the response rejects instead, the way a failed cursor
// already fails the export.
import type { ServerResponse } from 'node:http';

/** Writes one chunk: true while the response takes more, false once the client has gone. */
export type DrainingWrite = (chunk: string) => Promise<boolean>;

interface Waiter {
  resolve: (open: boolean) => void;
  reject: (error: Error) => void;
}

/** Call it before the first write to `res`, and use only the returned function to write. */
export const drainingWriter = (res: ServerResponse): DrainingWrite => {
  let gone = false;
  let failure: Error | null = null;
  let waiting: Waiter[] = [];
  const wake = (settle: (waiter: Waiter) => void): void => {
    const woken = waiting;
    waiting = [];
    for (const waiter of woken) settle(waiter);
  };

  res.on('drain', () => {
    wake((waiter) => waiter.resolve(true));
  });
  res.on('close', () => {
    gone = true;
    wake((waiter) => waiter.resolve(false));
  });
  res.on('error', (error: Error) => {
    gone = true;
    failure = error;
    wake((waiter) => waiter.reject(error));
  });

  return async (chunk) => {
    if (failure !== null) throw failure;
    // `destroyed` covers a client that left before this writer was made, when its 'close' had
    // already been emitted.
    if (gone || res.destroyed) return false;
    if (res.write(chunk)) return true;
    return new Promise<boolean>((resolve, reject) => {
      waiting.push({ resolve, reject });
    });
  };
};
