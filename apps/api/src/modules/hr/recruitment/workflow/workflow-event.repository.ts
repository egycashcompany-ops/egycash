// Outbox data access (I15). Append-only apart from dispatch bookkeeping.
import { Types, type ClientSession } from 'mongoose';
import { type BaseDocFields } from '../../../../shared/base/base.model';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { WorkflowEventModel, type WorkflowEventDoc } from './workflow-event.model';

type NewEvent = Omit<
  WorkflowEventDoc,
  keyof BaseDocFields | 'dispatchedAt' | 'dispatchAttempts' | 'dispatchError'
>;

class WorkflowEventRepository extends BaseRepository<WorkflowEventDoc> {
  constructor() {
    super(WorkflowEventModel, { branchField: 'branchId', softDelete: false });
  }

  /** Written in the SAME transaction as the aggregate change (I15). */
  async append(event: NewEvent, session?: ClientSession): Promise<WorkflowEventDoc> {
    const created = await this.model.create([event], session === undefined ? {} : { session });
    return created[0]!.toObject<WorkflowEventDoc>();
  }

  /** The dispatcher's queue: committed but not yet published, oldest first. */
  async listUndispatched(limit: number): Promise<WorkflowEventDoc[]> {
    return this.model
      .find({ dispatchedAt: null })
      .sort({ occurredAt: 1 })
      .limit(limit)
      .lean<WorkflowEventDoc[]>()
      .exec();
  }

  async markDispatched(eventId: string): Promise<void> {
    await this.model.updateOne({ eventId }, { $set: { dispatchedAt: new Date() } }).exec();
  }

  async markDispatchFailed(eventId: string, error: string): Promise<void> {
    await this.model
      .updateOne({ eventId }, { $set: { dispatchError: error }, $inc: { dispatchAttempts: 1 } })
      .exec();
  }

  async findByApplicant(applicantId: string, limit = 200): Promise<WorkflowEventDoc[]> {
    if (!Types.ObjectId.isValid(applicantId)) return [];
    return this.model
      .find({ applicantId: new Types.ObjectId(applicantId) })
      .sort({ occurredAt: -1 })
      .limit(limit)
      .lean<WorkflowEventDoc[]>()
      .exec();
  }
}

export const workflowEventRepository = new WorkflowEventRepository();
