import { type ClientSession } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import { OperationsAreaModel, type OperationsAreaDoc } from './area.model';

class OperationsAreaRepository extends BaseRepository<OperationsAreaDoc> {
  constructor() {
    super(OperationsAreaModel, {}); // organization-level reference data, no org scoping
  }

  /**
   * The ACTIVE areas' names — what a crew row's «الاتجاه» may name since Round 20 («لازم اختار من
   * الاتجاهات اللى موجوده»). A list of areas is a few hundred rows at most; read whole, once a save.
   */
  async activeNames(): Promise<string[]> {
    const rows = await this.model
      .find({ isDeleted: false, isActive: true }, { name: 1 })
      .sort({ name: 1 })
      .lean<{ name: string }[]>()
      .exec();
    return rows.map((row) => row.name);
  }

  /**
   * Every live area, stopped ones included — what a branch sheet's areas are matched against
   * (Round 29): the unique name holds among all of them. Inside `session` when given (Round 29b).
   */
  async liveAll(session?: ClientSession): Promise<OperationsAreaDoc[]> {
    return this.model
      .find({ isDeleted: false })
      .sort({ _id: 1 })
      .session(session ?? null)
      .lean<OperationsAreaDoc[]>()
      .exec();
  }
}

export const operationsAreaRepository = new OperationsAreaRepository();
