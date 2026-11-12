// A28 — «مستندات الوظائف» on «جاهزون للتعيين»: «يظهر كل الوظاءف و جمبو كل المستنات بس بردو متعلم علي
// النمازج الخاصه بوظيفتو و فنفس الوقت باقي النمازج موجوده بس مش معموله mark … ولو عاوز ازود اقدر
// براحتي ازود».
//
// Every active job beside every published paper, the papers the job prints ticked: what its
// templates give it, as changed here. Saving a job keeps what it now prints as what was added to,
// and taken off, what its templates give it — so a paper published later for every job still
// reaches it, and a job never changed here keeps following its templates. From then on, «عقد جديد»,
// «طباعة لكل المحدد» and the employee's «طباعة العقد والمستندات» tick exactly that for the job.
import { Types } from 'mongoose';
import { type JobPapersDto, type UpdateJobPapers } from '@ecms/contracts';
import { ValidationError } from '../../../../shared/errors';
import { type AuthContext } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { jobTitleService } from '../../../../platform/organization';
import { contractTemplateService } from '../contract-templates';
import { printSettings, type ContractTemplateDoc } from '../contract-templates/contract-template.model';
import { inPrintOrder, isTickedForJob, papersOfJob } from '../candidates/candidate-draft.service';
import { templatesForJob } from '../contracts/hiring-pack.service';
import { type JobPaperOverride } from './job-papers.model';
import { jobPapersRepository } from './job-papers.repository';

// On the job title's own history, where its other changes are.
const jobRef = (jobTitleId: string) => ({ moduleId: 'platform', entityType: 'jobTitle', entityId: jobTitleId });

/** The keys a job prints — ticked on its line — in print order. */
export const tickedKeys = (
  published: readonly ContractTemplateDoc[],
  jobTitleId: string,
  jobName: string | null,
  override: JobPaperOverride | null,
): string[] =>
  papersOfJob(published, jobTitleId, jobName, override)
    .filter(isTickedForJob)
    .map((paper) => paper.template.key);

/**
 * What a job keeps when it is saved printing `keys`: what was added to, and taken off, every paper
 * its templates give it. Applied back, it gives exactly `keys`.
 */
export const overrideFor = (
  published: readonly ContractTemplateDoc[],
  jobTitleId: string,
  keys: readonly string[],
): JobPaperOverride => {
  const given = templatesForJob(published, jobTitleId);
  const fromTemplates = new Set([...given.contracts, ...given.forms].map((template) => template.key));
  const wanted = new Set(keys);
  return {
    added: [...wanted].filter((key) => !fromTemplates.has(key)),
    removed: [...fromTemplates].filter((key) => !wanted.has(key)),
  };
};

class JobPapersService {
  async list(): Promise<JobPapersDto> {
    const published = [...(await contractTemplateService.listPublished())].sort(inPrintOrder);
    const overrides = new Map(
      (await jobPapersRepository.listAll()).map((row) => [String(row.jobTitleId), { added: row.added, removed: row.removed }]),
    );
    const jobs = await jobTitleService.options();
    return {
      papers: published.map((template) => ({ key: template.key, name: template.name, kind: printSettings(template).kind })),
      jobs: jobs.map((job) => ({
        jobTitleId: job.id,
        name: job.name,
        keys: tickedKeys(published, job.id, job.name.ar, overrides.get(job.id) ?? null),
      })),
    };
  }

  /** Save what each job on the request now prints. A job prints one contract at most. */
  async update(ctx: AuthContext, input: UpdateJobPapers): Promise<JobPapersDto> {
    const published = await contractTemplateService.listPublished();
    const byKey = new Map(published.map((template) => [template.key, template]));
    for (const [index, line] of input.jobs.entries()) {
      const keys = [...new Set(line.keys)];
      const unknown = keys.filter((key) => !byKey.has(key));
      if (unknown.length > 0) {
        throw new ValidationError([
          { field: `body.jobs.${index}.keys`, code: 'INVALID', message: `not a published paper: ${unknown.join(', ')}` },
        ]);
      }
      if (keys.filter((key) => printSettings(byKey.get(key) as ContractTemplateDoc).kind === 'contract').length > 1) {
        throw new ValidationError([
          { field: `body.jobs.${index}.keys`, code: 'INVALID', message: 'a job prints one contract' },
        ]);
      }
    }

    for (const line of input.jobs) {
      const job = await jobTitleService.getById(line.jobTitleId);
      const existing = await jobPapersRepository.findByJob(line.jobTitleId);
      const before = tickedKeys(
        published,
        line.jobTitleId,
        job.name.ar,
        existing === null ? null : { added: existing.added, removed: existing.removed },
      );
      const override = overrideFor(published, line.jobTitleId, line.keys);
      const after = tickedKeys(published, line.jobTitleId, job.name.ar, override);
      if (existing === null) {
        await jobPapersRepository.create(
          { jobTitleId: new Types.ObjectId(line.jobTitleId), added: override.added.slice(), removed: override.removed.slice() },
          { by: ctx.userId },
        );
      } else {
        await jobPapersRepository.updateById(
          String(existing._id),
          { added: override.added.slice(), removed: override.removed.slice() },
          { by: ctx.userId, version: existing.__v },
        );
      }
      await auditService.record({
        entityRef: jobRef(line.jobTitleId),
        action: 'update',
        changes: [{ field: 'hiringPapers', old: before.join(','), new: after.join(',') }],
        actor: { userId: ctx.userId, ip: null, userAgent: null },
      });
    }
    return this.list();
  }
}

export const jobPapersService = new JobPapersService();
