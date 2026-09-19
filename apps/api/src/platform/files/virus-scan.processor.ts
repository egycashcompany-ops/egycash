// The `virusScan` processor, at last (Security Architecture §3, ADR-010's "malware-scan hook").
//
// Registered only when `CLAMAV_HOST` is set. Without it nothing changes: uploads stay `unscanned`,
// the download gate has nothing to wait for, and a deployment that runs no daemon is exactly the
// deployment it was yesterday. With it, every upload is `pending` until the worker has streamed
// the bytes to clamd and heard back — and `pending` is withheld from every download path, because
// a scanner that exists and has not answered is not the same as no scanner.
//
// FAILS CLOSED. The client throws for everything that is not a verdict — daemon down, timed out,
// closed early, `ERROR` — and the pipeline turns a throw into `failed`, which leaves the file
// `pending`. It is never marked clean on the strength of a network fault; the rescan sweep
// (`platform.files.rescanPending`) brings it back once the daemon is reachable.
import {
  pingClamd,
  scanStreamWithClamd,
  type ClamdOptions,
} from '../../infrastructure/antivirus/clamd';
import { env } from '../../infrastructure/config/env';
import { logger } from '../../infrastructure/logging/logger';
import { getStorageProvider } from '../../infrastructure/storage';
import { registerFileProcessor } from './file.processors';

const clamdOptions = (): ClamdOptions | null =>
  env.CLAMAV_HOST === ''
    ? null
    : { host: env.CLAMAV_HOST, port: env.CLAMAV_PORT, timeoutMs: env.CLAMAV_TIMEOUT_MS };

/**
 * Registers the scanner when one is configured. Returns whether it did, so the boot can say so.
 *
 * Boot does not wait on the daemon. It pings it once and LOGS the answer — a compose stack brings
 * clamd up slower than the api (the signature database loads first), and a boot that failed on
 * that would fail every restart of every stack. Uploads made while the daemon is still coming up
 * sit at `pending` and are rescanned; nothing is lost and nothing is served unscanned.
 */
export const registerVirusScanner = (): boolean => {
  const options = clamdOptions();
  if (options === null) return false;

  registerFileProcessor({
    id: 'virusScan',
    handler: async (file) => {
      const stream = await getStorageProvider().getStream(file.storage.key);
      const outcome = await scanStreamWithClamd(stream, options);
      if (outcome.verdict === 'infected') {
        logger.warn(
          { fileId: String(file._id), signature: outcome.signature, size: file.size },
          'virus scanner blocked a file',
        );
        return { result: 'blocked', detail: { engine: 'clamav', signature: outcome.signature } };
      }
      return { result: 'ok', detail: { engine: 'clamav' } };
    },
  });

  void pingClamd(options).then((reachable) => {
    const target = { host: options.host, port: options.port };
    if (reachable) logger.info(target, 'virus scanner registered: clamd reachable');
    else
      logger.error(
        target,
        'virus scanner registered but clamd is not answering — uploads will stay pending until it is',
      );
  });
  return true;
};
