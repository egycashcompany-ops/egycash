// The owner's hiring papers, written into «قوالب العقود» on boot (A27, stage 2).
//
// «أنا هحوّل الـ١٣ ورقة لقوالب جوه البرنامج … مش هتحتاج تكتب حاجة». Each paper in
// `hiring-papers.ts` becomes a template the first time the API starts after this release:
//
//   · the contract is published for every job, with a fixed-term contract type — the company's
//     own «محدد المدة» type when there is one, else one made here;
//   · a form for every job is published as it is;
//   · a job's paper (a description card, the weapon declaration) is published for the jobs whose
//     names it carries. When no job by that name exists yet, it waits as a DRAFT — and a draft no
//     person has touched is matched again on every boot, so it publishes on the boot after the job
//     is created. HR can also tick its jobs by hand and publish it.
//   · a job's paper published here and untouched since FOLLOWS ITS JOBS: a job carrying its name
//     created since (or a name the paper gained in a release) is added on the next boot. None is
//     ever taken away.
//
// IDEMPOTENT, AND NEVER OVER SOMEBODY'S EDIT. A paper is recognized by its template key. Once a
// row with that key exists, this file leaves it alone — unless it is still the untouched row it
// wrote, in which case it only matches the jobs again. An edit, a publish, an archive or a delete
// by a person is final. Re-running it on a database where every paper is in place writes nothing.
//
// It never stops the boot: a paper that fails is logged and the others go on.
import { type Types } from 'mongoose';
import { logger } from '../../../../infrastructure/logging/logger';
import { auditService } from '../../../../platform/audit';
import { JobTitleModel } from '../../../../platform/organization/job-titles/job-title.model';
import { normalizeArabic } from '../../shared/arabic';
import { matchesJob } from '../../shared/job-match';
import { ContractTemplateModel } from '../contract-templates/contract-template.model';
import { ContractTypeModel } from '../contract-types/contract-type.model';
import { extractPlaceholders, sanitizeTemplateHtml } from '../shared/template-html';
import { HIRING_PAPERS, type HiringPaper, type PaperJobs } from './hiring-papers';

interface JobRow {
  _id: Types.ObjectId;
  name: { ar: string };
}

/** The jobs among `titles` a paper prints for — empty for a paper for every job. */
export const jobsFor = (jobs: PaperJobs, titles: readonly JobRow[]): Types.ObjectId[] =>
  jobs === 'all' ? [] : titles.filter((title) => matchesJob(jobs, title.name.ar)).map((title) => title._id);

/** A paper's sections exactly as the template service stores them, and the keys they use. */
export const preparedSections = (
  paper: HiringPaper,
): { sections: HiringPaper['sections']; placeholders: string[] } => {
  const sections = {
    header: sanitizeTemplateHtml(paper.sections.header),
    body: sanitizeTemplateHtml(paper.sections.body),
    footer: sanitizeTemplateHtml(paper.sections.footer),
  };
  return { sections, placeholders: extractPlaceholders(`${sections.header}\n${sections.body}\n${sections.footer}`) };
};

const FIXED_TERM = { ar: 'عقد عمل محدد المدة', en: 'Fixed-term employment contract' };
const SYSTEM = { userId: null, ip: null, userAgent: null };
const templateRef = (id: string) => ({ moduleId: 'hr', entityType: 'contractTemplate', entityId: id });

/** The company's fixed-term contract type — its own when it has one, else one made now. */
const fixedTermType = async (): Promise<Types.ObjectId> => {
  const types = await ContractTypeModel.find({ isDeleted: false, status: 'active', allowsEndDate: true }).lean();
  const own = types.find((type) => normalizeArabic(type.name.ar).includes(normalizeArabic('محدد المدة')));
  if (own !== undefined) return own._id;
  const made = await ContractTypeModel.create({ name: FIXED_TERM, allowsEndDate: true });
  await auditService.record({
    entityRef: { moduleId: 'hr', entityType: 'contractType', entityId: String(made._id) },
    action: 'create',
    changes: [{ field: 'name', old: null, new: FIXED_TERM.ar }],
    actor: SYSTEM,
  });
  return made._id;
};

export interface HiringTemplatesReport {
  /** Written now, and published. */
  published: string[];
  /** Written now, or already waiting, with no job to print for yet. */
  waiting: string[];
  /** A waiting draft matched to its jobs now, and published. */
  linked: string[];
  /** A published paper given a job named for it since. */
  widened: string[];
}

export const syncHiringTemplates = async (): Promise<HiringTemplatesReport> => {
  const report: HiringTemplatesReport = { published: [], waiting: [], linked: [], widened: [] };
  const titles = await JobTitleModel.find({ isDeleted: false, status: 'active' }, { name: 1 }).lean<JobRow[]>();

  for (const paper of HIRING_PAPERS) {
    try {
      const jobTitleIds = jobsFor(paper.jobs, titles);
      const ready = paper.jobs === 'all' || jobTitleIds.length > 0;
      const rows = await ContractTemplateModel.find({ key: paper.key }).lean();

      if (rows.length > 0) {
        const [row] = rows;
        const untouched =
          rows.length === 1 && row !== undefined && !row.isDeleted && row.changedBy === null && row.updatedBy === null;
        if (!untouched) continue;
        if (row.status === 'published') {
          // A job named for it since: added, never one taken away — and only to the row as written.
          if (paper.jobs === 'all' || (row.allJobs ?? true)) continue;
          const held = row.jobTitleIds ?? [];
          const added = jobTitleIds.filter((id) => !held.some((own) => String(own) === String(id)));
          if (added.length === 0) continue;
          const next = [...held, ...added];
          const done = await ContractTemplateModel.updateOne(
            { _id: row._id, __v: row.__v, status: 'published', changedBy: null, updatedBy: null },
            { $set: { jobTitleIds: next }, $inc: { __v: 1 } },
          );
          if (done.modifiedCount === 1) {
            await auditService.record({
              entityRef: templateRef(String(row._id)),
              action: 'update',
              changes: [{ field: 'jobTitleIds', old: held.map(String).join(','), new: next.map(String).join(',') }],
              actor: SYSTEM,
            });
            report.widened.push(paper.key);
          }
          continue;
        }
        if (row.status !== 'draft') continue;
        if (!ready) {
          report.waiting.push(paper.key);
          continue;
        }
        // Only the draft this file wrote, still as it wrote it — a person's edit since loses the race.
        const done = await ContractTemplateModel.updateOne(
          { _id: row._id, __v: row.__v, status: 'draft', changedBy: null, updatedBy: null },
          { $set: { jobTitleIds, status: 'published' }, $inc: { __v: 1 } },
        );
        if (done.modifiedCount === 1) {
          await auditService.record({
            entityRef: templateRef(String(row._id)),
            action: 'templatePublished',
            changes: [{ field: 'jobTitleIds', old: null, new: jobTitleIds.map(String).join(',') }],
            actor: SYSTEM,
          });
          report.linked.push(paper.key);
        }
        continue;
      }

      const { sections, placeholders } = preparedSections(paper);
      const doc = await ContractTemplateModel.create({
        key: paper.key,
        name: paper.name,
        language: 'ar',
        contractTypeId: paper.kind === 'contract' ? await fixedTermType() : null,
        status: ready ? 'published' : 'draft',
        templateVersion: 1,
        sections,
        logoFileId: null,
        signatures: paper.signatures,
        kind: paper.kind,
        allJobs: paper.jobs === 'all',
        jobTitleIds,
        printOrder: paper.printOrder,
        placeholders,
        changedBy: null,
      });
      await auditService.record({
        entityRef: templateRef(String(doc._id)),
        action: 'create',
        changes: [
          { field: 'key', old: null, new: paper.key },
          { field: 'status', old: null, new: doc.status },
        ],
        actor: SYSTEM,
      });
      (ready ? report.published : report.waiting).push(paper.key);
    } catch (error) {
      // Another instance booting at the same moment wrote it first (the key+version index).
      if ((error as { code?: number }).code === 11000) continue;
      logger.error({ err: error, key: paper.key }, 'hiring templates: a paper could not be written');
    }
  }

  if (report.published.length + report.linked.length + report.waiting.length + report.widened.length > 0) {
    logger.info(report, 'hiring templates: the owner\'s papers synced');
  }
  return report;
};
