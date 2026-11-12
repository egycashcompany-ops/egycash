// A28 — a person's papers, read for their department and job (`job-papers.rules.ts`), with what
// «مستندات الوظائف» set for that line fetched.
import { departmentRepository } from '../../../../platform/organization';
import { type ContractTemplateDoc } from '../contract-templates/contract-template.model';
import { jobPapersRepository } from './job-papers.repository';
import { papersOfJob, type JobPaper } from './job-papers.rules';

/**
 * The department «مستندات الوظائف» keys a branch's department row by: the company's department it
 * declares (its catalog entry, one for every branch), else the row itself.
 */
export const departmentKeyOf = async (departmentId: string | null): Promise<string | null> => {
  if (departmentId === null) return null;
  const row = await departmentRepository.findById(departmentId);
  return row === null ? departmentId : String(row.catalogId ?? row._id);
};

/** The papers of a person in `departmentId` holding the job `jobTitleId` (named `jobName`). */
export const papersOfPerson = async (
  published: readonly ContractTemplateDoc[],
  person: { departmentId: string | null; jobTitleId: string; jobName: string | null },
): Promise<JobPaper[]> => {
  const department = await departmentKeyOf(person.departmentId);
  return papersOfJob(
    published,
    person.jobTitleId,
    person.jobName,
    await jobPapersRepository.overrideOf(department, person.jobTitleId),
  );
};
