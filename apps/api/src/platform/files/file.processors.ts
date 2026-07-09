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

const runProcessors = async (file: FileDoc): Promise<void> => {
  for (const processor of processors.values()) {
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
    const { fileId } = data as { fileId: string };
    const file = await fileRepository.findAnyById(fileId);
    if (file === null || file.isDeleted) return; // deleted before processing — nothing to do
    await runProcessors(file);
  });
};

/** Called by the upload/replace paths; a no-op while no processor is registered. */
export const enqueueFileProcessing = async (fileId: Types.ObjectId): Promise<void> => {
  if (!hasAnyFileProcessor()) return;
  await enqueue('files', FILE_PROCESS_JOB, { fileId: String(fileId) });
};
