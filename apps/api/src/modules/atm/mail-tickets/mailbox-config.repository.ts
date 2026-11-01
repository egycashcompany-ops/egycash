import { type Types } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import {
  ATM_MAILBOX_KEY,
  AtmMailboxConfigModel,
  type AtmMailPollRunRecord,
  type AtmMailboxConfigDoc,
} from './mailbox-config.model';

class AtmMailboxConfigRepository extends BaseRepository<AtmMailboxConfigDoc> {
  constructor() {
    // Company-wide configuration: no branch field, `atmSettings.manage` at organization decides.
    super(AtmMailboxConfigModel, {});
  }

  /** The one live document; `null` while the reader still runs on the environment. */
  async findSingleton(): Promise<AtmMailboxConfigDoc | null> {
    return this.model
      .findOne({ key: ATM_MAILBOX_KEY, isDeleted: false })
      .lean<AtmMailboxConfigDoc>()
      .exec();
  }

  /**
   * The reader's status line. An `updateOne` on an EXISTING row — never an upsert: a document
   * created here would end environment mode without anybody having switched the screen on — and
   * outside the versioned write path (`__v` and `updatedAt` stay put), so a poll never makes the
   * screen's next save stale.
   */
  async recordLastPoll(id: Types.ObjectId, run: AtmMailPollRunRecord): Promise<void> {
    await this.model
      .updateOne({ _id: id, isDeleted: false }, { $set: { lastPoll: run } }, { timestamps: false })
      .exec();
  }
}

export const atmMailboxConfigRepository = new AtmMailboxConfigRepository();
