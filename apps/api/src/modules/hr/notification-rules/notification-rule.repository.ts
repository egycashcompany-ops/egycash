// Data access for notification rules. A leaf, so the bridge and the service can both read it.
import { Types, type UpdateQuery } from 'mongoose';
import { NotificationRuleModel, type NotificationRuleDoc } from './notification-rule.model';

export const notificationRuleRepository = {
  /**
   * The enabled rules for one event.
   *
   * Called on EVERY event the platform emits, so it is indexed and narrow: most events match no
   * rule at all, and that answer has to be cheap.
   */
  async enabledForEvent(event: string): Promise<NotificationRuleDoc[]> {
    return NotificationRuleModel.find({ event, enabled: true, isDeleted: false })
      .lean<NotificationRuleDoc[]>()
      .exec();
  },

  /** Newest first — a rules screen is read to find what somebody just added far more often than to browse. */
  async list(page: number, pageSize: number): Promise<{ items: NotificationRuleDoc[]; total: number }> {
    const filter = { isDeleted: false };
    const [items, total] = await Promise.all([
      NotificationRuleModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean<NotificationRuleDoc[]>()
        .exec(),
      NotificationRuleModel.countDocuments(filter).exec(),
    ]);
    return { items, total };
  },

  async findById(id: string): Promise<NotificationRuleDoc | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return NotificationRuleModel.findOne({ _id: new Types.ObjectId(id), isDeleted: false })
      .lean<NotificationRuleDoc>()
      .exec();
  },

  async create(input: Omit<NotificationRuleDoc, '_id' | '__v'>): Promise<NotificationRuleDoc> {
    const doc = await NotificationRuleModel.create(input);
    return doc.toObject() as NotificationRuleDoc;
  },

  /**
   * Update at a known version. Returns `null` when the row moved underneath the caller, which the
   * service turns into a stale-document conflict rather than overwriting somebody else's edit —
   * two people editing who gets told what is exactly where a lost update matters.
   */
  async updateAtVersion(
    id: string,
    version: number,
    patch: UpdateQuery<NotificationRuleDoc>,
  ): Promise<NotificationRuleDoc | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return NotificationRuleModel.findOneAndUpdate(
      { _id: new Types.ObjectId(id), isDeleted: false, __v: version },
      { ...patch, $inc: { __v: 1 } },
      { new: true },
    )
      .lean<NotificationRuleDoc>()
      .exec();
  },

  /** Soft delete, so a rule that fired can still be traced from the notifications it created. */
  async softDelete(id: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false;
    const result = await NotificationRuleModel.updateOne(
      { _id: new Types.ObjectId(id), isDeleted: false },
      { $set: { isDeleted: true } },
    ).exec();
    return result.matchedCount > 0;
  },

  /**
   * Record that a rule fired. Fire-and-forget by design: this is bookkeeping about a notification
   * that has already been created, and failing it must not fail the delivery it describes.
   */
  async recordFired(id: Types.ObjectId, at: Date): Promise<void> {
    await NotificationRuleModel.updateOne(
      { _id: id },
      { $inc: { firedCount: 1 }, $set: { lastFiredAt: at } },
    ).exec();
  },
};
