import { BaseRepository } from '../../../shared/base/base.repository';
import { AutomationVariableModel, type AutomationVariableDoc } from './variable.model';

class AutomationVariableRepository extends BaseRepository<AutomationVariableDoc> {
  constructor() {
    super(AutomationVariableModel, { branchField: 'branchId' });
  }

  async findScoped(
    key: string,
    scope: string,
    branchId: string | null,
    workflowId: string | null,
  ): Promise<AutomationVariableDoc | null> {
    return this.model.findOne({ key, scope, branchId, workflowId, isDeleted: false }).exec();
  }
}

export const automationVariableRepository = new AutomationVariableRepository();
