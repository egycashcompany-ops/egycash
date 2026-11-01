import { Types, type ClientSession } from 'mongoose';
import { type FleetFuelReconcileDecision } from '@ecms/contracts';
import { BaseRepository } from '../../../../shared/base/base.repository';
import {
  FleetFuelReconciliationModel,
  type FleetFuelReconciliationDoc,
} from './fuel-reconcile.model';

class FleetFuelReconciliationRepository extends BaseRepository<FleetFuelReconciliationDoc> {
  constructor() {
    super(FleetFuelReconciliationModel, {});
  }

  /** One live session, read inside `session` — a decision is checked against what it IS now. */
  async findLive(id: string, session: ClientSession): Promise<FleetFuelReconciliationDoc | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.model
      .findOne({ _id: new Types.ObjectId(id), isDeleted: false })
      .session(session)
      .lean<FleetFuelReconciliationDoc>()
      .exec();
  }

  /**
   * Write one line's decision — only while it has none. `false` when the line was decided in the
   * meantime (or is not there), so the caller refuses instead of deciding a card twice.
   */
  async decideLine(
    id: Types.ObjectId,
    cardId: Types.ObjectId,
    decision: {
      decision: FleetFuelReconcileDecision;
      at: Date;
      by: string;
      movementId: Types.ObjectId;
    },
    session: ClientSession,
  ): Promise<boolean> {
    const by = new Types.ObjectId(decision.by);
    const result = await this.model
      .updateOne(
        { _id: id, isDeleted: false, lines: { $elemMatch: { cardId, decision: null } } },
        {
          $set: {
            'lines.$.decision': decision.decision,
            'lines.$.decidedAt': decision.at,
            'lines.$.decidedBy': by,
            'lines.$.movementId': decision.movementId,
            updatedBy: by,
          },
          $inc: { __v: 1 },
        },
        { session },
      )
      .exec();
    return result.modifiedCount === 1;
  }
}

export const fleetFuelReconciliationRepository = new FleetFuelReconciliationRepository();
