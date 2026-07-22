import { BaseRepository } from '../../../../shared/base/base.repository';
import { EvaluationPhaseModel, type EvaluationPhaseDoc } from './evaluation-phase.model';

class EvaluationPhaseRepository extends BaseRepository<EvaluationPhaseDoc> {
  constructor() {
    super(EvaluationPhaseModel, {}); // organization-level catalog, no branch scope
  }

  async findByKey(key: string): Promise<EvaluationPhaseDoc | null> {
    return this.model.findOne({ key, isDeleted: false }).lean<EvaluationPhaseDoc>().exec();
  }

  async findActiveById(id: string): Promise<EvaluationPhaseDoc | null> {
    const doc = await this.findById(id);
    return doc !== null && doc.active ? doc : null;
  }

  /** The active phase at exactly `order`, if any. */
  async findActiveByOrder(order: number): Promise<EvaluationPhaseDoc | null> {
    return this.model.findOne({ isDeleted: false, active: true, order }).lean<EvaluationPhaseDoc>().exec();
  }

  /** All active phases in sequence order — drives the pipeline "cleared all" gate. */
  async findAllActive(): Promise<EvaluationPhaseDoc[]> {
    return this.model.find({ isDeleted: false, active: true }).sort({ order: 1 }).lean<EvaluationPhaseDoc[]>().exec();
  }
}

export const evaluationPhaseRepository = new EvaluationPhaseRepository();
