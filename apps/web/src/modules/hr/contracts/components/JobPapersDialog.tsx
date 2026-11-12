// «مستندات الوظائف» on «جاهزون للتعيين» (A28) — «اول مدوس عليه هيكون pop up يظهر كل الوظاءف و جمبو كل
// المستنات بس بردو متعلم علي النمازج الخاصه بوظيفتو و فنفس الوقت باقي النمازج موجوده بس مش معموله mark
// علي اساس اني قدامي كل النمازج ولو عاوز ازود اقدر براحتي ازود».
//
// Every job on a line of its own, and beside it EVERY paper, as the same tiles as «عقد جديد»: the
// papers the job prints ticked, the rest there and unticked. Tick one to add it to the job, untick
// one to take it off; «حفظ» keeps the lines that changed. From then on, a person of that job opens
// «عقد جديد» and «طباعة لكل المحدد» with exactly these ticked. A job prints ONE contract: ticking a
// contract unticks the line's other one.
import { useEffect, useMemo, useState } from 'react';
import { type JobPapersDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Button } from '../../../../shared/ui/Button';
import { Input } from '../../../../shared/ui';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { localized } from '../../../../shared/lib/format';
import { columnSearchMatches } from '../../../../shared/lib/column-filter';
import { useJobPapers, useSaveJobPapers } from '../api/contract-queries';
import { PaperTile } from './PaperTile';

/** What is ticked on each job's line, by job. */
export type JobChoice = ReadonlyMap<string, ReadonlySet<string>>;

export const choiceOf = (data: JobPapersDto): JobChoice =>
  new Map(data.jobs.map((job) => [job.jobTitleId, new Set(job.keys)]));

/**
 * A line with one paper ticked or not. A job prints one contract: ticking a contract unticks the
 * line's other contracts.
 */
export const toggled = (
  papers: JobPapersDto['papers'],
  line: ReadonlySet<string>,
  key: string,
  on: boolean,
): Set<string> => {
  const next = new Set(line);
  if (!on) {
    next.delete(key);
    return next;
  }
  if (papers.find((p) => p.key === key)?.kind === 'contract') {
    for (const paper of papers) if (paper.kind === 'contract') next.delete(paper.key);
  }
  next.add(key);
  return next;
};

/** «تحديد الكل» on a line: every form, and its contract — the one ticked, else the first. */
export const everyPaper = (papers: JobPapersDto['papers'], line: ReadonlySet<string>): string[] => {
  const contracts = papers.filter((p) => p.kind === 'contract');
  const contract = contracts.find((p) => line.has(p.key)) ?? contracts[0];
  return papers.filter((p) => p.kind === 'form' || p.key === contract?.key).map((p) => p.key);
};

/** The lines that differ from what was loaded, each with every paper it now prints, in print order. */
export const changedJobs = (data: JobPapersDto, chosen: JobChoice): { jobTitleId: string; keys: string[] }[] =>
  data.jobs.flatMap((job) => {
    const now = chosen.get(job.jobTitleId) ?? new Set<string>();
    const before = new Set(job.keys);
    const same = now.size === before.size && [...now].every((key) => before.has(key));
    return same ? [] : [{ jobTitleId: job.jobTitleId, keys: data.papers.map((p) => p.key).filter((key) => now.has(key)) }];
  });

export const JobPapersDialog = ({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data, isLoading } = useJobPapers(open);
  const save = useSaveJobPapers();
  const [chosen, setChosen] = useState<JobChoice>(new Map());
  const [search, setSearch] = useState('');

  // Each time the dialog opens, every line as it is saved.
  useEffect(() => {
    if (open && data !== undefined) setChosen(choiceOf(data));
    if (!open) setSearch('');
  }, [open, data]);

  const changed = data === undefined ? [] : changedJobs(data, chosen);
  const shown = useMemo(() => {
    const jobs = data?.jobs ?? [];
    return jobs.filter((job) => columnSearchMatches(`${job.name.ar} ${job.name.en}`, search));
  }, [data, search]);

  const setLine = (jobTitleId: string, keys: Iterable<string>): void =>
    setChosen((current) => new Map(current).set(jobTitleId, new Set(keys)));
  const toggle = (jobTitleId: string, key: string, on: boolean): void =>
    setLine(jobTitleId, toggled(data?.papers ?? [], chosen.get(jobTitleId) ?? new Set(), key, on));

  const confirm = async (): Promise<void> => {
    if (changed.length === 0) return;
    try {
      await save.mutateAsync({ jobs: changed });
      toast.success(t('contracts.jobPapers.saved', { count: changed.length }));
      onClose();
    } catch {
      // the error itself is surfaced globally
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="full"
      title={t('contracts.jobPapers.title')}
      description={t('contracts.jobPapers.hint')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button disabled={changed.length === 0} loading={save.isPending} onClick={() => void confirm()} data-job-papers-save>
            {changed.length === 0 ? t('contracts.jobPapers.save') : t('contracts.jobPapers.saveCount', { count: changed.length })}
          </Button>
        </>
      }
    >
      {isLoading || data === undefined ? (
        <p className="text-sm text-slate-500">{t('common.loading')}</p>
      ) : (
        <section data-job-papers>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              {t('contracts.jobPapers.jobs', { count: data.jobs.length })}
            </h3>
            <div className="w-full sm:w-72">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('contracts.jobPapers.search')}
                aria-label={t('contracts.jobPapers.search')}
              />
            </div>
          </div>
          {shown.length === 0 ? (
            <p className="text-sm text-slate-500">{t('contracts.jobPapers.none')}</p>
          ) : (
            <ul className="max-h-[65vh] space-y-3 overflow-y-auto pe-1">
              {shown.map((job) => {
                const mine = chosen.get(job.jobTitleId) ?? new Set<string>();
                const dirty = changed.some((line) => line.jobTitleId === job.jobTitleId);
                return (
                  <li
                    key={job.jobTitleId}
                    className={[
                      'flex flex-col gap-3 rounded-lg border p-3 lg:flex-row lg:items-start',
                      dirty ? 'border-amber-300 bg-amber-50/40 dark:border-amber-700 dark:bg-amber-950/20' : 'border-slate-200 dark:border-slate-700',
                    ].join(' ')}
                    data-job-line={job.jobTitleId}
                  >
                    <div className="w-full shrink-0 lg:w-56">
                      <p className="font-medium">{localized(job.name, locale)}</p>
                      <div className="mt-2 flex flex-col items-start gap-1">
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700 dark:bg-slate-800 dark:text-blue-300">
                          {t('contracts.bulk.paperCount', { count: mine.size })}
                        </span>
                        {dirty && <span className="text-xs text-amber-700 dark:text-amber-300">{t('contracts.jobPapers.changed')}</span>}
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setLine(job.jobTitleId, everyPaper(data.papers, mine))}>
                            {t('contracts.candidate.selectAll')}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setLine(job.jobTitleId, [])}>
                            {t('contracts.candidate.selectNone')}
                          </Button>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2" data-job-papers-tiles>
                      {data.papers.map((paper) => (
                        <PaperTile
                          key={paper.key}
                          paperKey={paper.key}
                          name={localized(paper.name, locale)}
                          kind={paper.kind}
                          checked={mine.has(paper.key)}
                          onToggle={(on) => toggle(job.jobTitleId, paper.key, on)}
                        />
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </Dialog>
  );
};
