// A28 — «مسميات الوظائف لدى التأمينات» in «الإعدادات», beside «نموذج التقديم»: «هنحط كل الظائف بتاعتنا ك
// data اساسيه و جمب كل واحده … زرار صغير كدا اسمو تعديل … مثبت فيه المسمي الوظيفي عندنا و التعديل عمتا
// هيكون ف مسمي الوظيفي لدي التامينات و كود المهنه بس».
//
// Every active job of the company is a row; «تعديل» sets the job's title at the authority and its
// occupation code. What is kept is keyed by the job's name folded (`jobKey`: «أخصائى» meets
// «اخصائي»), as the first release of the page kept it. «نموذج رقم (1)» prints, for a person whose
// job carries it, the insurance title (else the job's own) and the occupation code in its boxes.
import { type InsuranceJobTitlesDto, type UpdateInsuranceJobTitle } from '@ecms/contracts';
import { type AuthContext } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { jobTitleService } from '../../../../platform/organization';
import { jobKey } from '../../shared/job-match';
import { type InsuranceJobTitleDoc } from './insurance-job-title.model';
import { insuranceJobTitleRepository } from './insurance-job-title.repository';

const rowRef = (id: string) => ({ moduleId: 'hr', entityType: 'insuranceJobTitle', entityId: id });

/** The occupation code as form 1 boxes it: «123/456», or six digits split three and three. */
export const occupationCodeParts = (code: string): [string, string] => {
  const trimmed = code.trim();
  if (trimmed.includes('/')) {
    const [first = '', second = ''] = trimmed.split('/');
    return [first.trim(), second.trim()];
  }
  return [trimmed.slice(0, 3), trimmed.slice(3, 6)];
};

const snapshot = (row: Pick<InsuranceJobTitleDoc, 'jobTitle' | 'insuranceTitle' | 'occupationCode'> | null): string =>
  row === null ? '' : [row.jobTitle, row.insuranceTitle, row.occupationCode].join(' | ');

class InsuranceJobTitleService {
  /** The row for a person's job, by its name — null when none carries it. */
  async rowForJob(jobName: string): Promise<InsuranceJobTitleDoc | null> {
    return insuranceJobTitleRepository.findByNameKey(jobKey(jobName));
  }

  /** Every active job, by name, beside what is kept for it. */
  async list(): Promise<InsuranceJobTitlesDto> {
    const jobs = await jobTitleService.options();
    const kept = new Map((await insuranceJobTitleRepository.listAll()).map((row) => [row.nameKey, row]));
    return {
      rows: jobs
        .map((job) => {
          const row = kept.get(jobKey(job.name.ar));
          return {
            jobTitleId: job.id,
            jobTitle: job.name.ar,
            insuranceTitle: row?.insuranceTitle ?? '',
            occupationCode: row?.occupationCode ?? '',
          };
        })
        .sort((a, b) => a.jobTitle.localeCompare(b.jobTitle, 'ar')),
    };
  }

  /** «تعديل» on one job: keep its insurance title and occupation code — both empty, keep nothing. */
  async update(ctx: AuthContext, jobTitleId: string, input: UpdateInsuranceJobTitle): Promise<InsuranceJobTitlesDto> {
    const job = await jobTitleService.getById(jobTitleId);
    const nameKey = jobKey(job.name.ar);
    const set = { jobTitle: job.name.ar, insuranceTitle: input.insuranceTitle.trim(), occupationCode: input.occupationCode.trim() };
    const empty = set.insuranceTitle === '' && set.occupationCode === '';
    const current = await insuranceJobTitleRepository.findByNameKey(nameKey);
    const record = async (id: string, before: string, after: string): Promise<void> =>
      auditService.record({
        entityRef: rowRef(id),
        action: before === '' ? 'create' : after === '' ? 'delete' : 'update',
        changes: [{ field: 'row', old: before, new: after }],
        actor: { userId: ctx.userId, ip: null, userAgent: null },
      });

    if (current === null) {
      if (!empty) {
        const made = await insuranceJobTitleRepository.create({ ...set, nameKey }, { by: ctx.userId });
        await record(String(made._id), '', snapshot(set));
      }
    } else if (empty) {
      await insuranceJobTitleRepository.softDeleteById(String(current._id), { by: ctx.userId });
      await record(String(current._id), snapshot(current), '');
    } else if (snapshot(current) !== snapshot(set)) {
      await insuranceJobTitleRepository.updateById(String(current._id), set, { by: ctx.userId, version: current.__v });
      await record(String(current._id), snapshot(current), snapshot(set));
    }
    return this.list();
  }
}

export const insuranceJobTitleService = new InsuranceJobTitleService();
