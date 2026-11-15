// A28 — «مسميات الوظائف لدى التأمينات» in «الإعدادات», beside «نموذج التقديم»: «انا عاوز انا اللي احط
// المسميات الوظيفه بتاعتنا و المسميات الوظيفيه بتاعت التامينات و هنزود column … كود المهنه و كله هيتحط
// manual بس لما تتعمل save خلاص فهي by default لما اجي احط المسمي الوظيفي بتاعنا هيترمي في نموزج 1
// علي اساس المسمي الوظيفي لدي الالتامينات و كود المهنه».
//
// A table HR types: the company's job title, its title at the authority, its occupation code.
// «حفظ» keeps the table as it stands — a row left out is taken off. «نموذج رقم (1)» prints, for a
// person whose job carries a row's title (folded: «أخصائى» meets «اخصائي»), the row's insurance title
// (else the job's own) and its occupation code in the code's boxes.
import { type InsuranceJobTitlesDto, type UpdateInsuranceJobTitles } from '@ecms/contracts';
import { ValidationError } from '../../../../shared/errors';
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

  async list(): Promise<InsuranceJobTitlesDto> {
    const jobs = await jobTitleService.options();
    const known = new Set(jobs.map((job) => jobKey(job.name.ar)));
    const rows = await insuranceJobTitleRepository.listAll();
    return {
      rows: rows
        .map((row) => ({
          id: String(row._id),
          jobTitle: row.jobTitle,
          insuranceTitle: row.insuranceTitle,
          occupationCode: row.occupationCode,
          matched: known.has(row.nameKey),
        }))
        .sort((a, b) => a.jobTitle.localeCompare(b.jobTitle, 'ar')),
      jobNames: [...new Set(jobs.map((job) => job.name.ar))].sort((a, b) => a.localeCompare(b, 'ar')),
    };
  }

  /** Keep the table as it now stands: rows added, changed, and left out (taken off). */
  async update(ctx: AuthContext, input: UpdateInsuranceJobTitles): Promise<InsuranceJobTitlesDto> {
    const wanted = new Map<string, UpdateInsuranceJobTitles['rows'][number]>();
    for (const [index, row] of input.rows.entries()) {
      const key = jobKey(row.jobTitle);
      if (wanted.has(key)) {
        throw new ValidationError([
          { field: `body.rows.${index}.jobTitle`, code: 'DUPLICATE', message: `the job title is listed twice: ${row.jobTitle}` },
        ]);
      }
      wanted.set(key, row);
    }

    const existing = new Map((await insuranceJobTitleRepository.listAll()).map((row) => [row.nameKey, row]));
    const record = async (id: string, before: string, after: string): Promise<void> =>
      auditService.record({
        entityRef: rowRef(id),
        action: before === '' ? 'create' : after === '' ? 'delete' : 'update',
        changes: [{ field: 'row', old: before, new: after }],
        actor: { userId: ctx.userId, ip: null, userAgent: null },
      });

    for (const [nameKey, row] of wanted) {
      const set = { jobTitle: row.jobTitle.trim(), insuranceTitle: row.insuranceTitle.trim(), occupationCode: row.occupationCode.trim() };
      const current = existing.get(nameKey) ?? null;
      if (current === null) {
        const made = await insuranceJobTitleRepository.create({ ...set, nameKey }, { by: ctx.userId });
        await record(String(made._id), '', snapshot(set));
      } else if (snapshot(current) !== snapshot(set)) {
        await insuranceJobTitleRepository.updateById(String(current._id), set, { by: ctx.userId, version: current.__v });
        await record(String(current._id), snapshot(current), snapshot(set));
      }
    }
    for (const [nameKey, row] of existing) {
      if (wanted.has(nameKey)) continue;
      await insuranceJobTitleRepository.softDeleteById(String(row._id), { by: ctx.userId });
      await record(String(row._id), snapshot(row), '');
    }
    return this.list();
  }
}

export const insuranceJobTitleService = new InsuranceJobTitleService();
