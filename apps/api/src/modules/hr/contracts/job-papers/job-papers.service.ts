// A28 — «مستندات الوظائف» on «جاهزون للتعيين», by department and job: «اعرض الادارات كدا و الوظائف اللي
// جوه الادارات … علي حسب الاداره و الوظيفه».
//
// Every department, the jobs in it, and beside each job every published paper — ticked, what a
// person of that job in that department prints (`job-papers.rules.ts`). A department is the
// company's (a branch's department row keyed by the catalog entry it declares, so «العمليات» in
// every branch is one), or the branch's own row when it declares none. The jobs in a department are
// those its people hold — employees who have not exited, and candidates accepted and not hired yet —
// and any job saved for it here.
//
// Saving a line keeps what was added to, and taken off, what the templates tick for the job, so a
// paper published later for every job still reaches it, and a line never saved follows its templates
// (or the job-wide line the first release of this popup saved). From then on «عقد جديد», «طباعة لكل
// المحدد», the employee's tab, the printed set and the hire's contract read the person's papers so.
import { Types } from 'mongoose';
import { type JobPapersDto, type UpdateJobPapers } from '@ecms/contracts';
import { NotFoundError, ValidationError } from '../../../../shared/errors';
import { type AuthContext } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { departmentCatalogRepository, departmentService, jobTitleService } from '../../../../platform/organization';
import { employeeRepository } from '../../employee-management/employees';
import { jobOfferService } from '../../recruitment/job-offers';
import { contractTemplateService } from '../contract-templates';
import { printSettings, type ContractTemplateDoc } from '../contract-templates/contract-template.model';
import { type JobPaperOverride } from './job-papers.model';
import { jobPapersRepository } from './job-papers.repository';
import { inPrintOrder, overrideFor, tickedKeys } from './job-papers.rules';

// On the job title's own history, where its other changes are.
const jobRef = (jobTitleId: string) => ({ moduleId: 'platform', entityType: 'jobTitle', entityId: jobTitleId });

type Name = { ar: string; en: string };

/** A department as this popup keys it: its catalog entry, else the branch's own row. */
const keyOf = (option: { id: string; catalogId: string | null }): string => option.catalogId ?? option.id;

class JobPapersService {
  async list(): Promise<JobPapersDto> {
    const published = [...(await contractTemplateService.listPublished())].sort(inPrintOrder);
    const jobs = await jobTitleService.options();
    const jobName = new Map(jobs.map((job) => [job.id, job.name]));

    // The saved lines: a department's own, and the job-wide ones the first release saved.
    const rows = await jobPapersRepository.listAll();
    const own = new Map<string, JobPaperOverride>();
    const jobWide = new Map<string, JobPaperOverride>();
    for (const row of rows) {
      const override = { added: row.added, removed: row.removed };
      if (row.departmentId === null) jobWide.set(String(row.jobTitleId), override);
      else own.set(`${String(row.departmentId)}:${String(row.jobTitleId)}`, override);
    }
    const lineOf = (department: string, jobTitleId: string): string[] =>
      tickedKeys(
        published,
        jobTitleId,
        jobName.get(jobTitleId)?.ar ?? null,
        own.get(`${department}:${jobTitleId}`) ?? jobWide.get(jobTitleId) ?? null,
      );

    // Every department, once for the company; the jobs its people hold, and those saved for it.
    const options = await departmentService.options();
    const departments = new Map<string, { name: Name; jobs: Set<string> }>();
    const rowToKey = new Map<string, string>();
    for (const option of options) {
      const key = keyOf(option);
      rowToKey.set(option.id, key);
      if (!departments.has(key)) departments.set(key, { name: option.name, jobs: new Set() });
    }
    const held = [...(await employeeRepository.jobsByDepartmentSystem()), ...(await jobOfferService.acceptedJobsByDepartment())];
    for (const pair of held) {
      const key = rowToKey.get(pair.departmentId);
      if (key !== undefined && jobName.has(pair.jobTitleId)) departments.get(key)?.jobs.add(pair.jobTitleId);
    }
    for (const row of rows) {
      if (row.departmentId === null) continue;
      const department = departments.get(String(row.departmentId));
      if (department !== undefined && jobName.has(String(row.jobTitleId))) department.jobs.add(String(row.jobTitleId));
    }

    const byName = (a: { name: Name }, b: { name: Name }): number => a.name.ar.localeCompare(b.name.ar, 'ar');
    return {
      papers: published.map((template) => ({ key: template.key, name: template.name, kind: printSettings(template).kind })),
      departments: [...departments.entries()]
        .map(([departmentId, department]) => ({
          departmentId,
          name: department.name,
          jobs: [...department.jobs]
            .map((jobTitleId) => ({ jobTitleId, name: jobName.get(jobTitleId) as Name, keys: lineOf(departmentId, jobTitleId) }))
            .sort(byName),
        }))
        .sort(byName),
      jobs: jobs.map((job) => ({
        jobTitleId: job.id,
        name: job.name,
        keys: tickedKeys(published, job.id, job.name.ar, jobWide.get(job.id) ?? null),
      })),
    };
  }

  /** Save what each line on the request now prints. A line prints one contract at most. */
  async update(ctx: AuthContext, input: UpdateJobPapers): Promise<JobPapersDto> {
    const published = await contractTemplateService.listPublished();
    const byKey = new Map<string, ContractTemplateDoc>(published.map((template) => [template.key, template]));
    const departmentKeys = new Set((await departmentService.options()).map(keyOf));
    for (const [index, line] of input.lines.entries()) {
      const field = `body.lines.${index}`;
      const keys = [...new Set(line.keys)];
      const unknown = keys.filter((key) => !byKey.has(key));
      if (unknown.length > 0) {
        throw new ValidationError([{ field: `${field}.keys`, code: 'INVALID', message: `not a published paper: ${unknown.join(', ')}` }]);
      }
      if (keys.filter((key) => printSettings(byKey.get(key) as ContractTemplateDoc).kind === 'contract').length > 1) {
        throw new ValidationError([{ field: `${field}.keys`, code: 'INVALID', message: 'a job prints one contract' }]);
      }
      if (!departmentKeys.has(line.departmentId) && (await departmentCatalogRepository.findById(line.departmentId)) === null) {
        throw new NotFoundError('Department not found');
      }
    }

    for (const line of input.lines) {
      const job = await jobTitleService.getById(line.jobTitleId);
      const existing = await jobPapersRepository.findLine(line.departmentId, line.jobTitleId);
      const before = tickedKeys(
        published,
        line.jobTitleId,
        job.name.ar,
        await jobPapersRepository.overrideOf(line.departmentId, line.jobTitleId),
      );
      const override = overrideFor(published, line.jobTitleId, job.name.ar, [...new Set(line.keys)]);
      const set = { added: override.added.slice(), removed: override.removed.slice() };
      if (existing === null) {
        await jobPapersRepository.create(
          { departmentId: new Types.ObjectId(line.departmentId), jobTitleId: new Types.ObjectId(line.jobTitleId), ...set },
          { by: ctx.userId },
        );
      } else {
        await jobPapersRepository.updateById(String(existing._id), set, { by: ctx.userId, version: existing.__v });
      }
      const after = tickedKeys(published, line.jobTitleId, job.name.ar, override);
      await auditService.record({
        entityRef: jobRef(line.jobTitleId),
        action: 'update',
        changes: [{ field: `hiringPapers.${line.departmentId}`, old: before.join(','), new: after.join(',') }],
        actor: { userId: ctx.userId, ip: null, userAgent: null },
      });
    }
    return this.list();
  }
}

export const jobPapersService = new JobPapersService();
