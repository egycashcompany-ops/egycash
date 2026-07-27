// A22 — the STABLE query seam. Payroll, Employee Files, Workflow and Document Management
// integrate through these DTOs + the hr.contract.* events ONLY; the collections are
// module-private and never read directly by another module.
import { type ContractSnapshotDto } from '@ecms/contracts';
import { contractRepository } from './contract.repository';
import { type ContractDoc } from './contract.model';

const toSnapshot = (doc: ContractDoc): ContractSnapshotDto => ({
  contractId: String(doc._id),
  code: doc.code,
  contractVersion: doc.contractVersion,
  employeeId: String(doc.employeeId),
  status: doc.status,
  startDate: doc.startDate.toISOString().slice(0, 10),
  endDate: doc.endDate === null ? null : doc.endDate.toISOString().slice(0, 10),
  variables: doc.variables.map((v) => ({
    key: v.key,
    value: v.value,
    source: v.source,
    overriddenBy: v.overriddenBy === null ? null : String(v.overriddenBy),
  })),
  integrity:
    doc.generation.integrity === null
      ? null
      : {
          sha256: doc.generation.integrity.sha256,
          generatedAt: doc.generation.integrity.generatedAt.toISOString(),
          generatorVersion: doc.generation.integrity.generatorVersion,
          templateVersion: doc.generation.integrity.templateVersion,
          contractVersion: doc.generation.integrity.contractVersion,
        },
});

class ContractQueryService {
  /** The generated contract version in force for the employee at `at` (A10/A22). */
  async activeSnapshotAt(employeeId: string, at: Date): Promise<ContractSnapshotDto | null> {
    const doc = await contractRepository.findActiveAt(employeeId, at);
    return doc === null ? null : toSnapshot(doc);
  }

  async listForEmployee(employeeId: string): Promise<ContractSnapshotDto[]> {
    return (await contractRepository.listForEmployee(employeeId))
      .filter((doc) => doc.renderedHtml !== null)
      .map(toSnapshot);
  }

  async getSnapshot(contractId: string): Promise<ContractSnapshotDto | null> {
    const doc = await contractRepository.findById(contractId);
    return doc === null || doc.renderedHtml === null ? null : toSnapshot(doc);
  }
}

export const contractQueryService = new ContractQueryService();
