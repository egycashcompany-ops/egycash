// Data access for the inbox (Sprint 3.3 plan §3/§6). Not a `BaseRepository` — the
// collection has no own/branch/organization scope concept (ownership is direct
// `recipientUserId` equality) and no soft-delete (archival is `archivedAt`).
import { Types, type FilterQuery } from 'mongoose';
import { MAX_PAGE_SIZE, type Paginated } from '@ecms/contracts';
import { ConflictError } from '../../shared/errors';
import { NotificationModel, type NotificationDoc } from './notification.model';

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;

export interface ListNotificationsFilter {
  recipientUserId: string;
  unreadOnly: boolean;
  entityType?: string | undefined;
  entityId?: string | undefined;
  category?: string | undefined;
  page: number;
  pageSize: number;
}

class NotificationRepository {
  async create(doc: Omit<NotificationDoc, '_id'>): Promise<NotificationDoc> {
    try {
      const [created] = await NotificationModel.create([doc]);
      if (created === undefined) throw new ConflictError('notification create failed');
      return created.toObject();
    } catch (error) {
      if (isDuplicateKeyError(error)) throw new ConflictError('duplicate idempotencyKey');
      throw error;
    }
  }

  async findByIdempotencyKey(
    recipientUserId: string,
    idempotencyKey: string,
  ): Promise<NotificationDoc | null> {
    return NotificationModel.findOne({
      recipientUserId: new Types.ObjectId(recipientUserId),
      idempotencyKey,
    })
      .lean<NotificationDoc>()
      .exec();
  }

  async findOwnedById(id: string, recipientUserId: string): Promise<NotificationDoc | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return NotificationModel.findOne({
      _id: new Types.ObjectId(id),
      recipientUserId: new Types.ObjectId(recipientUserId),
    })
      .lean<NotificationDoc>()
      .exec();
  }

  async findAnyById(id: string): Promise<NotificationDoc | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return NotificationModel.findById(id).lean<NotificationDoc>().exec();
  }

  async list(params: ListNotificationsFilter): Promise<Paginated<NotificationDoc>> {
    const pageSize = Math.min(params.pageSize, MAX_PAGE_SIZE);
    const page = Math.max(1, params.page);
    const filter: FilterQuery<NotificationDoc> = {
      recipientUserId: new Types.ObjectId(params.recipientUserId),
      archivedAt: null,
    };
    if (params.unreadOnly) filter.readAt = null;
    if (params.entityType !== undefined) filter['entityRef.entityType'] = params.entityType;
    if (params.entityId !== undefined) filter['entityRef.entityId'] = params.entityId;
    if (params.category !== undefined) filter.category = params.category;

    const [items, totalItems] = await Promise.all([
      NotificationModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean<NotificationDoc[]>()
        .exec(),
      NotificationModel.countDocuments(filter).exec(),
    ]);
    return {
      items,
      meta: { page, pageSize, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / pageSize)) },
    };
  }

  async unreadCount(recipientUserId: string): Promise<number> {
    return NotificationModel.countDocuments({
      recipientUserId: new Types.ObjectId(recipientUserId),
      readAt: null,
      archivedAt: null,
    }).exec();
  }

  /** First-read-wins (Sprint 3.3 plan §6): conditional write, `null` if already read. */
  async markReadIfUnread(id: string, recipientUserId: string, at: Date): Promise<NotificationDoc | null> {
    return NotificationModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(id),
        recipientUserId: new Types.ObjectId(recipientUserId),
        readAt: null,
      },
      { $set: { readAt: at, 'channels.$[inApp].readAt': at, 'channels.$[inApp].status': 'read' } },
      {
        new: true,
        arrayFilters: [{ 'inApp.channel': 'inApp' }],
      },
    )
      .lean<NotificationDoc>()
      .exec();
  }

  async markAllRead(recipientUserId: string, at: Date): Promise<number> {
    const result = await NotificationModel.updateMany(
      { recipientUserId: new Types.ObjectId(recipientUserId), readAt: null, archivedAt: null },
      { $set: { readAt: at, 'channels.$[inApp].readAt': at, 'channels.$[inApp].status': 'read' } },
      { arrayFilters: [{ 'inApp.channel': 'inApp' }] },
    ).exec();
    return result.modifiedCount;
  }

  async archive(id: string, recipientUserId: string, at: Date): Promise<NotificationDoc | null> {
    return NotificationModel.findOneAndUpdate(
      { _id: new Types.ObjectId(id), recipientUserId: new Types.ObjectId(recipientUserId) },
      { $set: { archivedAt: at } },
      { new: true },
    )
      .lean<NotificationDoc>()
      .exec();
  }

  /** Appends a status transition for one channel entry (Sprint 3.3 plan §3b). */
  async setChannelStatus(
    id: Types.ObjectId,
    channel: string,
    status: string,
    at: Date,
    extra?: { sentAt?: Date; error?: string | null },
  ): Promise<void> {
    const set: Record<string, unknown> = { 'channels.$[c].status': status };
    if (extra?.sentAt !== undefined) set['channels.$[c].sentAt'] = extra.sentAt;
    if (extra?.error !== undefined) set['channels.$[c].error'] = extra.error;
    await NotificationModel.updateOne(
      { _id: id },
      {
        $set: set,
        $push: { 'channels.$[c].statusHistory': { status, at } },
      },
      { arrayFilters: [{ 'c.channel': channel }] },
    ).exec();
  }
}

export const notificationRepository = new NotificationRepository();
