import { Types, type ClientSession } from 'mongoose';
import { type Paginated } from '@ecms/contracts';
import { BaseRepository, type ListParams } from '../../../shared/base/base.repository';
import {
  OperationsCrewRequirementsModel,
  type OperationsCrewRequirementsDoc,
} from './crew-requirements.model';

class OperationsCrewRequirementsRepository extends BaseRepository<OperationsCrewRequirementsDoc> {
  constructor() {
    super(OperationsCrewRequirementsModel, {}); // an organization-wide roster, like the crew board
  }

  async findByEmployee(
    employeeId: string,
    session?: ClientSession,
  ): Promise<OperationsCrewRequirementsDoc | null> {
    return this.model
      .findOne({ employeeId: new Types.ObjectId(employeeId), isDeleted: false })
      .session(session ?? null)
      .lean<OperationsCrewRequirementsDoc>()
      .exec();
  }

  /**
   * The rows of these employees, in ONE read — the crew saves' slot rule (Round 23) asks about
   * everybody a save puts on a row at once, never one person at a time. Somebody with no row is
   * simply not in the answer.
   */
  async findByEmployees(
    employeeIds: readonly string[],
    session?: ClientSession,
  ): Promise<OperationsCrewRequirementsDoc[]> {
    if (employeeIds.length === 0) return [];
    return this.model
      .find({
        employeeId: { $in: employeeIds.map((id) => new Types.ObjectId(id)) },
        isDeleted: false,
      })
      .session(session ?? null)
      .lean<OperationsCrewRequirementsDoc[]>()
      .exec();
  }

  /** The whole roster — the crew board's pool. Small by nature: one desk's operations staff. */
  async findAll(): Promise<OperationsCrewRequirementsDoc[]> {
    return this.model
      .find({ isDeleted: false })
      .lean<OperationsCrewRequirementsDoc[]>()
      .exec();
  }

  async listRequirements(
    params: Omit<ListParams<OperationsCrewRequirementsDoc>, 'sortableFields'> & {
      filter: Record<string, unknown>;
    },
  ): Promise<Paginated<OperationsCrewRequirementsDoc>> {
    return this.list({ ...params, sortableFields: ['createdAt', 'updatedAt'] });
  }
}

export const operationsCrewRequirementsRepository = new OperationsCrewRequirementsRepository();
