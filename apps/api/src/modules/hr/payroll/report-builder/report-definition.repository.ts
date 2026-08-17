// Report definition data access (scope B1).
//
// AN ORGANIZATION-WIDE CATALOG, deliberately unscoped — like the pay-item catalog and unlike a
// payslip. A definition is a QUESTION, not an answer: it holds no employee, no branch and no
// figure, so there is nothing in it for an organizational scope to narrow. The narrowing happens
// where the money is, at execution, through the caller's own `scopeSelector`.
import { BaseRepository } from '../../../../shared/base/base.repository';
import { ReportDefinitionModel, type ReportDefinitionDoc } from './report-definition.model';

class ReportDefinitionRepository extends BaseRepository<ReportDefinitionDoc> {
  constructor() {
    super(ReportDefinitionModel, {});
  }
}

export const reportDefinitionRepository = new ReportDefinitionRepository();
