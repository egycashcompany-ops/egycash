// Post-upload EXTENSION POINTS (Platform Core §7): virus scanning, OCR, and
// thumbnail generation register here; the files service only owns the seam —
// concrete processors arrive with their own capabilities (e.g. OCR via the AI
// service, ADR-014). Processors run in the worker on the `files` queue.
import { type Types } from 'mongoose';
import { PlatformEvents } from '@ecms/contracts';
import { logger } from '../../infrastructure/logging/logger';
import { enqueue, registerJobHandler } from '../../infrastructure/queue/jobs';
import { emit, nudgeOutboxRelay } from '../kernel/event-bus';
import { fileRepository } from './file.repository';
import { type FileDoc } from './file.model';

export const FILE_PROCESS_JOB = 'files.process';

export interface FileProcessorResult {
  result: 'ok' | 'failed' | 'blocked';
  /** Processor-specific summary (thumbnail file id, extraction job id, verdict). */
  detail?: Record<string, unknown>;
}

export interface FileProcessor {
  /** Well-known ids get dedicated events: `virusScan`, `ocr`, `thumbnail`. */
  id: string;
  handler: (file: FileDoc) => Promise<FileProcessorResult>;
}

const processors = new Map<string, FileProcessor>();

export const registerFileProcessor = (processor: FileProcessor): void => {
  if (processors.has(processor.id)) {
    throw new Error(`duplicate file processor: ${processor.id}`);
  }
  processors.set(processor.id, processor);
};

export const hasFileProcessor = (id: string): boolean => processors.has(id);
export const hasAnyFileProcessor = (): boolean => processors.size > 0;

/** Test-only. */
export const clearFileProcessors = (): void => {
  processors.clear();
};

const COMPLETION_EVENTS: Record<string, string> = {
  virusScan: PlatformEvents.VirusScanCompleted,
  ocr: PlatformEvents.OcrCompleted,
  thumbnail: PlatformEvents.ThumbnailCreated,
};

/**
 * Runs the registered processors over a file — all of them, or only the ids in `only`. The rescan
 * sweep passes `['virusScan']`: a file the scanner never answered for needs its scan again, not a
 * second thumbnail and a second `ThumbnailCreated` event.
 */
const runProcessors = async (file: FileDoc, only?: readonly string[]): Promise<void> => {
  for (const processor of processors.values()) {
    if (only !== undefined && !only.includes(processor.id)) continue;
    let outcome: FileProcessorResult;
    try {
      outcome = await processor.handler(file);
    } catch (error) {
      logger.error(
        { err: error, processor: processor.id, fileId: String(file._id) },
        'file processor failed',
      );
      outcome = { result: 'failed' };
    }

    if (processor.id === 'virusScan') {
      await fileRepository.setScanStatus(
        file._id,
        outcome.result === 'ok' ? 'clean' : outcome.result === 'blocked' ? 'blocked' : 'pending',
      );
    }

    const eventName = COMPLETION_EVENTS[processor.id];
    if (eventName !== undefined) {
      // Reliable tier: completion has business consequences (a blocked file,
      // an OCR result a module waits for) and must survive a worker crash.
      await emit(
        eventName,
        {
          fileId: String(file._id),
          groupId: String(file.groupId),
          processor: processor.id,
          result: outcome.result,
          ...(outcome.detail === undefined ? {} : { detail: outcome.detail }),
        },
        { reliable: true },
      );
      nudgeOutboxRelay();
    }
  }
};

export const registerFileJobHandlers = (): void => {
  registerJobHandler('files', FILE_PROCESS_JOB, async (data) => {
    const { fileId, only } = data as { fileId: string; only?: string[] };
    const file = await fileRepository.findAnyById(fileId);
    if (file === null || file.isDeleted) return; // deleted before processing — nothing to do
    await runProcessors(file, only);
  });
};

/** Called by the upload/replace paths; a no-op while no processor is registered. */
export const enqueueFileProcessing = async (fileId: Types.ObjectId): Promise<void> => {
  if (!hasAnyFileProcessor()) return;
  await enqueue('files', FILE_PROCESS_JOB, { fileId: String(fileId) });
};

/** How long a file may sit at `pending` before the sweep decides its scan job is not coming. */
export const RESCAN_AFTER_MINUTES = 10;
const RESCAN_BATCH = 200;

/**
 * Re-queues the virus scan for files still `pending` after `RESCAN_AFTER_MINUTES` — the scanner
 * was down when their job ran, or the job died with the worker. The queue's own retries cover the
 * first minute of an outage; this covers the rest, at fifteen-minute steps, until the daemon is
 * back. Nothing to do on a deployment with no scanner: nothing there is ever `pending`.
 */
export const rescanPendingFiles = async (now = new Date()): Promise<number> => {
  if (!hasFileProcessor('virusScan')) return 0;
  const stale = new Date(now.getTime() - RESCAN_AFTER_MINUTES * 60_000);
  const files = await fileRepository.listPendingScans(stale, RESCAN_BATCH);
  for (const file of files) await enqueueVirusScan(file._id);
  return files.length;
};

/** The scan, and only the scan — no second thumbnail, no second `ThumbnailCreated`. */
export const enqueueVirusScan = async (fileId: Types.ObjectId): Promise<void> => {
  await enqueue('files', FILE_PROCESS_JOB, { fileId: String(fileId), only: ['virusScan'] });
};

export interface BacklogRescanReport {
  /** Live files that had never been scanned when the run started. */
  unscanned: number;
  /** Rows flipped `unscanned` → `pending` (0 on a dry run). */
  marked: number;
  /** Scan jobs handed to the queue (0 on a dry run). */
  queued: number;
  /** Files marked but not queued: the queue refused. The fifteen-minute sweep picks them up. */
  leftToSweep: number;
}

/**
 * Scan what was uploaded BEFORE a scanner existed (`rescan:files`).
 *
 * A file uploaded on a deployment with no scanner is `unscanned`, and stays that way when one is
 * switched on — scanning never happens retroactively on its own, because withholding every old
 * file at once is an operator's decision, not a boot's. This is that decision: every live
 * `unscanned` file becomes `pending` (withheld until its verdict) and a scan-only job is queued
 * for it, in batches, oldest first. Marking and queueing are separate acts on purpose — a row
 * marked while the queue is down is not lost; the sweep re-queues anything `pending` for longer
 * than its patience, so the outcome is the same, only slower.
 *
 * Refused outright when no scanner is registered: marking files `pending` with nothing to
 * answer would withhold them forever.
 */
export const rescanBacklog = async (options: {
  write: boolean;
  batch?: number;
  onBatch?: (progress: BacklogRescanReport) => void;
}): Promise<BacklogRescanReport> => {
  if (!hasFileProcessor('virusScan')) {
    throw new Error(
      'no virus scanner is registered (CLAMAV_HOST is unset) — nothing would ever answer',
    );
  }
  const batch = options.batch ?? RESCAN_BATCH;
  const report: BacklogRescanReport = {
    unscanned: await fileRepository.countUnscanned(),
    marked: 0,
    queued: 0,
    leftToSweep: 0,
  };
  if (!options.write) return report;

  let after: Types.ObjectId | null = null;
  for (;;) {
    const ids = await fileRepository.listUnscannedIds(batch, after);
    if (ids.length === 0) break;
    report.marked += await fileRepository.markUnscannedPending(ids);
    for (const id of ids) {
      try {
        await enqueueVirusScan(id);
        report.queued += 1;
      } catch (error) {
        report.leftToSweep += 1;
        logger.warn(
          { err: error, fileId: String(id) },
          'rescan: queue refused; the sweep will retry',
        );
      }
    }
    options.onBatch?.(report);
    after = ids[ids.length - 1] ?? null;
  }
  return report;
};
