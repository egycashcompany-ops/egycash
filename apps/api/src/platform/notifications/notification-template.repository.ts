// Versioned template data access (Sprint 3.3 plan §3). No separate counter
// collection — the unique `(key, version)` index IS the concurrency guard: a
// conflicting concurrent write fails with a duplicate-key error and is retried
// against the freshly-read max version (bounded — admin-driven edits, not
// high-concurrency file uploads).
import { Types } from 'mongoose';
import { ConflictError } from '../../shared/errors';
import { unitOfWork } from '../kernel/unit-of-work';
import {
  NotificationTemplateModel,
  type NotificationTemplateDoc,
} from './notification-template.model';

const MAX_VERSION_RETRIES = 5;

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;

class NotificationTemplateRepository {
  async findLatestByKey(key: string): Promise<NotificationTemplateDoc | null> {
    return NotificationTemplateModel.findOne({ key, isLatest: true })
      .lean<NotificationTemplateDoc>()
      .exec();
  }

  async findVersionById(id: string): Promise<NotificationTemplateDoc | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return NotificationTemplateModel.findById(id).lean<NotificationTemplateDoc>().exec();
  }

  async listVersions(key: string): Promise<NotificationTemplateDoc[]> {
    return NotificationTemplateModel.find({ key })
      .sort({ version: -1 })
      .lean<NotificationTemplateDoc[]>()
      .exec();
  }

  async listLatest(params: {
    page: number;
    pageSize: number;
    status?: string | undefined;
    category?: string | undefined;
  }): Promise<{ items: NotificationTemplateDoc[]; totalItems: number }> {
    const filter: Record<string, unknown> = { isLatest: true };
    if (params.status !== undefined) filter.status = params.status;
    if (params.category !== undefined) filter.category = params.category;
    const [items, totalItems] = await Promise.all([
      NotificationTemplateModel.find(filter)
        .sort({ key: 1 })
        .skip((params.page - 1) * params.pageSize)
        .limit(params.pageSize)
        .lean<NotificationTemplateDoc[]>()
        .exec(),
      NotificationTemplateModel.countDocuments(filter).exec(),
    ]);
    return { items, totalItems };
  }

  /**
   * Creates version 1 for a brand-new `key`. Fails with a conflict if the key already
   * has a version (use `createNextVersion` for edits).
   */
  async createFirstVersion(
    doc: Omit<NotificationTemplateDoc, '_id' | 'version' | 'isLatest'>,
  ): Promise<NotificationTemplateDoc> {
    try {
      const [created] = await NotificationTemplateModel.create([
        { ...doc, version: 1, isLatest: true },
      ]);
      if (created === undefined) throw new ConflictError('template create failed');
      return created.toObject();
    } catch (error) {
      if (isDuplicateKeyError(error)) throw new ConflictError(`Template key "${doc.key}" already exists`);
      throw error;
    }
  }

  /**
   * Publishes a new version for an existing `key`: atomically unsets the old
   * `isLatest` and inserts the next version (transactional — mirrors
   * `fileRepository.storeVersion`'s `markGroupNotLatest` + `create`, Sprint 3.1).
   */
  async createNextVersion(
    key: string,
    content: Omit<NotificationTemplateDoc, '_id' | 'key' | 'version' | 'isLatest'>,
  ): Promise<NotificationTemplateDoc> {
    for (let attempt = 0; attempt < MAX_VERSION_RETRIES; attempt += 1) {
      const current = await this.findLatestByKey(key);
      if (current === null) throw new ConflictError(`Unknown template key "${key}"`);
      const nextVersion = current.version + 1;
      try {
        return await unitOfWork(async (session) => {
          await NotificationTemplateModel.updateOne(
            { _id: current._id },
            { $set: { isLatest: false } },
            { session },
          ).exec();
          const [created] = await NotificationTemplateModel.create(
            [{ ...content, key, version: nextVersion, isLatest: true }],
            { session },
          );
          if (created === undefined) throw new ConflictError('template version create failed');
          return created.toObject();
        });
      } catch (error) {
        if (isDuplicateKeyError(error) && attempt < MAX_VERSION_RETRIES - 1) continue;
        throw error;
      }
    }
    throw new ConflictError(`Could not allocate a new version for template "${key}"`);
  }
}

export const notificationTemplateRepository = new NotificationTemplateRepository();
