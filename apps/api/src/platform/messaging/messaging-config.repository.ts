import { type Types } from 'mongoose';
import { DEFAULT_MESSAGE_CHANNEL } from '@ecms/contracts';
import { BaseRepository } from '../../shared/base/base.repository';
import { ConflictError } from '../../shared/errors';
import {
  MESSAGING_CONFIG_KEY,
  MessagingConfigModel,
  type MessagingConfigDoc,
  type SmsTestRunRecord,
} from './messaging-config.model';

class MessagingConfigRepository extends BaseRepository<MessagingConfigDoc> {
  constructor() {
    // Company-wide configuration: no branch field, `setting.edit` decides.
    super(MessagingConfigModel, {});
  }

  /** The one live document; `null` while the messages still go as they did before the screen. */
  async findSingleton(): Promise<MessagingConfigDoc | null> {
    return this.model
      .findOne({ key: MESSAGING_CONFIG_KEY, isDeleted: false })
      .lean<MessagingConfigDoc>()
      .exec();
  }

  /**
   * The document, created with the defaults on the first save. Created FIRST, before anything is
   * sealed, so the token's sealing context can name the record it belongs to. A racing first save
   * that lost on the unique key reads the winner's document instead of failing.
   */
  async ensureSingleton(by: string | null): Promise<{ doc: MessagingConfigDoc; created: boolean }> {
    const existing = await this.findSingleton();
    if (existing !== null) return { doc: existing, created: false };
    try {
      const doc = await this.create(
        {
          key: MESSAGING_CONFIG_KEY,
          channel: DEFAULT_MESSAGE_CHANNEL,
          sms: {
            enabled: false,
            provider: 'etisalat',
            templateId: null,
            tokenRef: null,
            tokenUpdatedAt: null,
            lastTest: null,
          },
        },
        { by },
      );
      return { doc, created: true };
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;
      const raced = await this.findSingleton();
      if (raced === null) throw error;
      return { doc: raced, created: false };
    }
  }

  /**
   * The test button's status line. An `updateOne` on an EXISTING row, outside the versioned write
   * path (`__v` and `updatedAt` stay put), so a test never makes the screen's next save stale.
   */
  async recordLastTest(id: Types.ObjectId, run: SmsTestRunRecord): Promise<void> {
    await this.model
      .updateOne(
        { _id: id, isDeleted: false },
        { $set: { 'sms.lastTest': run } },
        { timestamps: false },
      )
      .exec();
  }
}

export const messagingConfigRepository = new MessagingConfigRepository();
