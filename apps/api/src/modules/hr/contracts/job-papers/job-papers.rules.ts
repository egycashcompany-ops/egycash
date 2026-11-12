// A28 — the papers a person prints, by department and job: «النمازج المخصصه بس للاداره او الوظائف هي
// اللي هتكون موجوده … فيه وظائف تتفتحلها نمازج معينه و وظائف تانيه ملهاش علاقه بنمازج معينه».
//
// Pure: given the published templates, the job, its name and what «مستندات الوظائف» set for the
// job in the person's department, which papers the person is offered, which start ticked, and under
// which heading. Every print page — «عقد جديد», «طباعة لكل المحدد», the employee's tab, the printed
// set — and the hire's contract read a person's papers through here.
//
//   · THE TEMPLATES give the job its papers: those for every job and those for its own (their
//     «الوظائف»). Ticked, but one a paper is ticked only for other jobs (`tickedFor`, the weapon
//     declaration): offered unticked.
//   · «مستندات الوظائف» changes what is ticked for the job in the department: papers ADDED, papers
//     TAKEN OFF. A paper taken off is not offered at all; one only offered stays offered, unticked.
//   · ONE CONTRACT: the first ticked by print order is the person's contract.
import { type CandidatePaperGroup } from '@ecms/contracts';
import { printSettings, type ContractTemplateDoc } from '../contract-templates/contract-template.model';
import { optionalForJob } from '../hiring-templates';
import { type JobPaperOverride } from './job-papers.model';

/** One of a person's papers, with where it belongs on the page. */
export interface JobPaper {
  template: ContractTemplateDoc;
  group: CandidatePaperGroup;
  /** Offered, but not ticked until HR ticks it. */
  optional: boolean;
}

/** Does this template print for `jobTitleId`, as its own «الوظائف» say? */
export const appliesToJob = (template: ContractTemplateDoc, jobTitleId: string): boolean => {
  const settings = printSettings(template);
  return settings.allJobs || settings.jobTitleIds.some((id) => String(id) === jobTitleId);
};

/** Contracts first, then forms, each in print order — the order papers are listed and printed in. */
export const inPrintOrder = (a: ContractTemplateDoc, b: ContractTemplateDoc): number => {
  const kindA = printSettings(a).kind === 'contract' ? 0 : 1;
  const kindB = printSettings(b).kind === 'contract' ? 0 : 1;
  return (
    kindA - kindB ||
    printSettings(a).printOrder - printSettings(b).printOrder ||
    a.name.ar.localeCompare(b.name.ar, 'ar')
  );
};

/** The published templates a job's own «الوظائف» give it, contracts and forms, in print order. */
export const templatesForJob = (
  published: readonly ContractTemplateDoc[],
  jobTitleId: string,
): { contracts: ContractTemplateDoc[]; forms: ContractTemplateDoc[] } => {
  const mine = published.filter((template) => appliesToJob(template, jobTitleId)).sort(inPrintOrder);
  return {
    contracts: mine.filter((template) => printSettings(template).kind === 'contract'),
    forms: mine.filter((template) => printSettings(template).kind === 'form'),
  };
};

/** What the templates give the job: the keys ticked (one contract), and the keys only offered. */
const givenByTemplates = (
  published: readonly ContractTemplateDoc[],
  jobTitleId: string,
  jobName: string | null,
): { ticked: string[]; offered: string[] } => {
  const { contracts, forms } = templatesForJob(published, jobTitleId);
  const contract = contracts[0];
  return {
    ticked: [
      ...(contract === undefined ? [] : [contract.key]),
      ...forms.filter((form) => !optionalForJob(form.key, jobName)).map((form) => form.key),
    ],
    offered: forms.filter((form) => optionalForJob(form.key, jobName)).map((form) => form.key),
  };
};

/**
 * A person's papers, in print order: what the templates give their job, as «مستندات الوظائف» changed
 * it for the job in their department (`override`) — each ticked unless only offered.
 */
export const papersOfJob = (
  published: readonly ContractTemplateDoc[],
  jobTitleId: string,
  jobName: string | null = null,
  override: JobPaperOverride | null = null,
): JobPaper[] => {
  const given = givenByTemplates(published, jobTitleId, jobName);
  const removed = new Set(override?.removed ?? []);
  const ticked = new Set([...given.ticked.filter((key) => !removed.has(key)), ...(override?.added ?? [])]);
  const offered = new Set(given.offered.filter((key) => !ticked.has(key)));
  const mine = published.filter((template) => ticked.has(template.key) || offered.has(template.key)).sort(inPrintOrder);
  // One contract: the first ticked is the person's; another is never offered beside it.
  const contract = mine.find((template) => printSettings(template).kind === 'contract');
  return mine
    .filter((template) => printSettings(template).kind === 'form' || template === contract)
    .map((template) => ({
      template,
      group:
        printSettings(template).kind === 'contract'
          ? 'contract'
          : printSettings(template).allJobs
            ? 'everyJob'
            : 'thisJob',
      optional: offered.has(template.key),
    }));
};

/** The papers ticked for the person until somebody ticks otherwise. */
export const isTickedForJob = (paper: Pick<JobPaper, 'optional'>): boolean => !paper.optional;

/** The keys of a job's papers ticked in a department, in print order — its line in «مستندات الوظائف». */
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
 * What a line keeps when saved ticking `keys`: what was added to, and taken off, what the templates
 * tick for the job. Applied back, it ticks exactly `keys`.
 */
export const overrideFor = (
  published: readonly ContractTemplateDoc[],
  jobTitleId: string,
  jobName: string | null,
  keys: readonly string[],
): JobPaperOverride => {
  const given = new Set(givenByTemplates(published, jobTitleId, jobName).ticked);
  const wanted = new Set(keys);
  return {
    added: [...wanted].filter((key) => !given.has(key)),
    removed: [...given].filter((key) => !wanted.has(key)),
  };
};
