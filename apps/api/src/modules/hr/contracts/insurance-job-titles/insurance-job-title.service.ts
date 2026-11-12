// A28 — «مسميات الوظائف لدى التأمينات» in «الإعدادات», beside «نموذج التقديم»: «فيه مسميات وظائف اسمها
// فالنموزج المسمي عندنا مختلفه عن مسميات الوظائف عند التامينات … هيسمح اني احط مسمي الوظيفي بتاعي و
// قدامو المسمي الوظيفي لدى التامينات عشان … يحط فنموزج 1 المسمي الوظيفي بتاع التامينات».
//
// Every active job title beside its title at the authority. «نموذج رقم (1)» prints the authority's
// title for a person's job (`job.insuranceTitle`); a job with none set prints its own title, so a
// form never comes out with the job left empty.
import { Types } from 'mongoose';
import { type InsuranceJobTitlesDto, type UpdateInsuranceJobTitles } from '@ecms/contracts';
import { type AuthContext } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { jobTitleService } from '../../../../platform/organization';
import { insuranceJobTitleRepository } from './insurance-job-title.repository';

// On the job title's own history, where its other changes are.
const jobRef = (jobTitleId: string) => ({ moduleId: 'platform', entityType: 'jobTitle', entityId: jobTitleId });

class InsuranceJobTitleService {
  /** The job's title at the authority, or null when none is set. */
  async titleOf(jobTitleId: string): Promise<string | null> {
    return (await insuranceJobTitleRepository.findByJob(jobTitleId))?.title ?? null;
  }

  async list(): Promise<InsuranceJobTitlesDto> {
    const titles = new Map((await insuranceJobTitleRepository.listAll()).map((row) => [String(row.jobTitleId), row.title]));
    const jobs = await jobTitleService.options();
    return {
      jobs: jobs
        .map((job) => ({ jobTitleId: job.id, code: job.code, name: job.name, insuranceTitle: titles.get(job.id) ?? '' }))
        .sort((a, b) => a.name.ar.localeCompare(b.name.ar, 'ar')),
    };
  }

  /** Save each job's title at the authority; an empty one takes it off — the job prints its own. */
  async update(ctx: AuthContext, input: UpdateInsuranceJobTitles): Promise<InsuranceJobTitlesDto> {
    for (const line of input.titles) {
      await jobTitleService.getById(line.jobTitleId);
      const existing = await insuranceJobTitleRepository.findByJob(line.jobTitleId);
      const before = existing?.title ?? '';
      const after = line.insuranceTitle.trim();
      if (before === after) continue;
      if (existing === null) {
        await insuranceJobTitleRepository.create(
          { jobTitleId: new Types.ObjectId(line.jobTitleId), title: after },
          { by: ctx.userId },
        );
      } else if (after === '') {
        await insuranceJobTitleRepository.softDeleteById(String(existing._id), { by: ctx.userId });
      } else {
        await insuranceJobTitleRepository.updateById(String(existing._id), { title: after }, { by: ctx.userId, version: existing.__v });
      }
      await auditService.record({
        entityRef: jobRef(line.jobTitleId),
        action: 'update',
        changes: [{ field: 'insuranceTitle', old: before, new: after }],
        actor: { userId: ctx.userId, ip: null, userAgent: null },
      });
    }
    return this.list();
  }
}

export const insuranceJobTitleService = new InsuranceJobTitleService();
