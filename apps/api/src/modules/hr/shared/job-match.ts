// Matching a paper to jobs by NAME (A27). Job titles carry no other link to the owner's papers: the
// printed papers («مستندات التعيين») and the papers collected from a new hire (the crew leader's
// weapon declaration) both say which jobs they are for by the job's Arabic name, folded so that
// «أخصائى عد و فرز» meets «اخصائي عد وفرز».
import { normalizeArabic } from './arabic';

/** The jobs carrying these names. */
export interface JobNames {
  /** A job named exactly this, or this followed by more words («أمين خزينة أول»). */
  family: readonly string[];
  /** A job named exactly this and nothing more. */
  exact?: readonly string[];
}

/** The jobs a paper is for: every job, or the jobs carrying these names. */
export type JobMatch = 'all' | JobNames;

/** A job name folded for matching: «أخصائى عد و فرز» meets «اخصائي عد وفرز». */
export const jobKey = (name: string): string => normalizeArabic(name).replace(/ و /g, ' و');

/** Is a paper for the job named `jobName`? */
export const matchesJob = (jobs: JobMatch, jobName: string): boolean => {
  if (jobs === 'all') return true;
  const job = jobKey(jobName);
  const inFamily = jobs.family.some((name) => {
    const key = jobKey(name);
    return job === key || job.startsWith(`${key} `);
  });
  return inFamily || (jobs.exact ?? []).some((name) => job === jobKey(name));
};

/** «قائد طاقم» — crew leaders, of every kind («قائد طاقم صراف آلي» …). */
export const CREW_LEADERS: JobNames = { family: ['قائد طاقم'] };

/** «أخصائي نقل أموال» — the cash-in-transit specialists who ride with the crew leader. */
export const CIT_SPECIALISTS: JobNames = { family: ['أخصائى نقل اموال'] };
