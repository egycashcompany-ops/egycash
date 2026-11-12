// «مستندات الوظائف» on «جاهزون للتعيين» (A28) — the papers each person prints, by department and job:
// «اعرض الادارات كدا و الوظائف اللي جوه الادارات … علي حسب الاداره و الوظيفه … فيه وظائف تتفتحلها
// نمازج معينه و وظائف تانيه ملهاش علاقه بنمازج معينه».
//
// Every department, opened to the jobs in it; beside each job EVERY paper, as the same tiles as
// «عقد جديد»: what a person of that job in that department prints ticked, the rest there unticked.
// The first line of a department, «كل وظائف الإدارة», ticks or unticks a paper for every job in it at
// once. A job nobody holds in the department yet is added to it from its foot. «حفظ» keeps the lines
// that changed. A job prints ONE contract: ticking a contract unticks the line's other one.
import { useEffect, useMemo, useState } from 'react';
import { type JobPapersDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Button } from '../../../../shared/ui/Button';
import { Input, Select } from '../../../../shared/ui';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { localized } from '../../../../shared/lib/format';
import { columnSearchMatches } from '../../../../shared/lib/column-filter';
import { useJobPapers, useSaveJobPapers } from '../api/contract-queries';
import { PaperTile } from './PaperTile';

type Papers = JobPapersDto['papers'];
type Job = JobPapersDto['jobs'][number];

/** A job in a department — one line of the popup. */
export const lineKey = (departmentId: string, jobTitleId: string): string => `${departmentId}:${jobTitleId}`;

/** What is ticked on each line, by `lineKey`. */
export type LineChoice = ReadonlyMap<string, ReadonlySet<string>>;

/** Jobs added to a department here, not yet saved: by department, in the order added. */
export type AddedJobs = ReadonlyMap<string, readonly Job[]>;

export const choiceOf = (data: JobPapersDto): LineChoice =>
  new Map(
    data.departments.flatMap((department) =>
      department.jobs.map((job) => [lineKey(department.departmentId, job.jobTitleId), new Set(job.keys)] as const),
    ),
  );

/**
 * A line with one paper ticked or not. A job prints one contract: ticking a contract unticks the
 * line's other contracts.
 */
export const toggled = (papers: Papers, line: ReadonlySet<string>, key: string, on: boolean): Set<string> => {
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
export const everyPaper = (papers: Papers, line: ReadonlySet<string>): string[] => {
  const contracts = papers.filter((p) => p.kind === 'contract');
  const contract = contracts.find((p) => line.has(p.key)) ?? contracts[0];
  return papers.filter((p) => p.kind === 'form' || p.key === contract?.key).map((p) => p.key);
};

/** A department's jobs: those loaded, then those added here. */
export const jobsOf = (department: JobPapersDto['departments'][number], added: AddedJobs): Job[] => [
  ...department.jobs,
  ...(added.get(department.departmentId) ?? []).filter((job) => !department.jobs.some((j) => j.jobTitleId === job.jobTitleId)),
];

/**
 * The lines to save: each that differs from what was loaded, and each job added to a department, with
 * every paper it now prints, in print order.
 */
export const changedLines = (
  data: JobPapersDto,
  chosen: LineChoice,
  added: AddedJobs,
): { departmentId: string; jobTitleId: string; keys: string[] }[] =>
  data.departments.flatMap((department) =>
    jobsOf(department, added).flatMap((job) => {
      const key = lineKey(department.departmentId, job.jobTitleId);
      const now = chosen.get(key) ?? new Set(job.keys);
      const loaded = department.jobs.find((j) => j.jobTitleId === job.jobTitleId);
      const before = new Set(loaded?.keys ?? []);
      const same = loaded !== undefined && now.size === before.size && [...now].every((k) => before.has(k));
      return same
        ? []
        : [{ departmentId: department.departmentId, jobTitleId: job.jobTitleId, keys: data.papers.map((p) => p.key).filter((k) => now.has(k)) }];
    }),
  );

export const JobPapersDialog = ({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data, isLoading } = useJobPapers(open);
  const save = useSaveJobPapers();
  const [chosen, setChosen] = useState<LineChoice>(new Map());
  const [added, setAdded] = useState<AddedJobs>(new Map());
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [adding, setAdding] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');

  // Each time the dialog opens, every line as it is saved, every department closed.
  useEffect(() => {
    if (open && data !== undefined) {
      setChosen(choiceOf(data));
      setAdded(new Map());
      setOpened(new Set());
      setAdding({});
    }
    if (!open) setSearch('');
  }, [open, data]);

  const papers = data?.papers ?? [];
  const changed = data === undefined ? [] : changedLines(data, chosen, added);
  const searching = search.trim() !== '';

  // A department shows when its name or one of its jobs matches; searching opens it at its matches.
  const shown = useMemo(
    () =>
      (data?.departments ?? []).flatMap((department) => {
        const jobs = jobsOf(department, added);
        if (!searching) return [{ department, jobs }];
        if (columnSearchMatches(`${department.name.ar} ${department.name.en}`, search)) return [{ department, jobs }];
        const matching = jobs.filter((job) => columnSearchMatches(`${job.name.ar} ${job.name.en}`, search));
        return matching.length === 0 ? [] : [{ department, jobs: matching }];
      }),
    [data, added, search],
  );

  const lineOf = (departmentId: string, job: Job): ReadonlySet<string> =>
    chosen.get(lineKey(departmentId, job.jobTitleId)) ?? new Set(job.keys);
  const setLine = (departmentId: string, jobTitleId: string, keys: Iterable<string>): void =>
    setChosen((current) => new Map(current).set(lineKey(departmentId, jobTitleId), new Set(keys)));
  const toggle = (departmentId: string, job: Job, key: string, on: boolean): void =>
    setLine(departmentId, job.jobTitleId, toggled(papers, lineOf(departmentId, job), key, on));
  /** «كل وظائف الإدارة»: one paper on or off for every job in the department. */
  const toggleAll = (departmentId: string, jobs: readonly Job[], key: string, on: boolean): void =>
    setChosen((current) => {
      const next = new Map(current);
      for (const job of jobs) {
        const line = next.get(lineKey(departmentId, job.jobTitleId)) ?? new Set(job.keys);
        next.set(lineKey(departmentId, job.jobTitleId), toggled(papers, line, key, on));
      }
      return next;
    });
  const flip = (departmentId: string): void =>
    setOpened((current) => {
      const next = new Set(current);
      if (next.has(departmentId)) next.delete(departmentId);
      else next.add(departmentId);
      return next;
    });
  const addJob = (departmentId: string): void => {
    const job = data?.jobs.find((j) => j.jobTitleId === adding[departmentId]);
    if (job === undefined) return;
    setAdded((current) => new Map(current).set(departmentId, [...(current.get(departmentId) ?? []), job]));
    setLine(departmentId, job.jobTitleId, job.keys);
    setAdding((current) => ({ ...current, [departmentId]: '' }));
  };

  const confirm = async (): Promise<void> => {
    if (changed.length === 0) return;
    try {
      await save.mutateAsync({ lines: changed });
      toast.success(t('contracts.jobPapers.saved', { count: changed.length }));
      onClose();
    } catch {
      // the error itself is surfaced globally
    }
  };

  const tiles = (checked: (key: string) => boolean, onToggle: (key: string, on: boolean) => void): JSX.Element => (
    <div className="flex flex-wrap gap-2" data-job-papers-tiles>
      {papers.map((paper) => (
        <PaperTile
          key={paper.key}
          paperKey={paper.key}
          name={localized(paper.name, locale)}
          kind={paper.kind}
          checked={checked(paper.key)}
          onToggle={(on) => onToggle(paper.key, on)}
        />
      ))}
    </div>
  );

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
              {t('contracts.jobPapers.departments', { count: data.departments.length })}
            </h3>
            <div className="w-full sm:w-80">
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
              {shown.map(({ department, jobs }) => {
                const id = department.departmentId;
                const isOpen = searching || opened.has(id);
                const dirty = changed.filter((line) => line.departmentId === id).length;
                const free = data.jobs.filter((job) => !jobsOf(department, added).some((j) => j.jobTitleId === job.jobTitleId));
                return (
                  <li key={id} className="rounded-lg border border-slate-200 dark:border-slate-700" data-department={id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-start"
                      onClick={() => flip(id)}
                      aria-expanded={isOpen}
                      data-department-toggle={id}
                    >
                      <span className="flex items-center gap-2">
                        <span aria-hidden="true" className={`text-slate-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}>‹</span>
                        <span className="font-semibold">{localized(department.name, locale)}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {t('contracts.jobPapers.jobsIn', { count: jobsOf(department, added).length })}
                        </span>
                      </span>
                      {dirty > 0 && <span className="text-xs text-amber-700 dark:text-amber-300">{t('contracts.jobPapers.changed')}</span>}
                    </button>
                    {isOpen && (
                      <div className="space-y-3 border-t border-slate-100 p-3 dark:border-slate-800">
                        {jobs.length === 0 ? (
                          <p className="text-sm text-slate-500">{t('contracts.jobPapers.noJobs')}</p>
                        ) : (
                          <div
                            className="flex flex-col gap-3 rounded-lg bg-blue-50/50 p-3 lg:flex-row lg:items-start dark:bg-slate-800/40"
                            data-department-all={id}
                          >
                            <div className="w-full shrink-0 lg:w-56">
                              <p className="font-medium text-blue-800 dark:text-blue-300">{t('contracts.jobPapers.allJobs')}</p>
                              <p className="mt-1 text-xs text-slate-500">{t('contracts.jobPapers.allJobsHint')}</p>
                            </div>
                            {tiles(
                              (key) => jobs.every((job) => lineOf(id, job).has(key)),
                              (key, on) => toggleAll(id, jobs, key, on),
                            )}
                          </div>
                        )}
                        {jobs.map((job) => {
                          const mine = lineOf(id, job);
                          const lineDirty = changed.some((line) => line.departmentId === id && line.jobTitleId === job.jobTitleId);
                          return (
                            <div
                              key={job.jobTitleId}
                              className={[
                                'flex flex-col gap-3 rounded-lg border p-3 lg:flex-row lg:items-start',
                                lineDirty
                                  ? 'border-amber-300 bg-amber-50/40 dark:border-amber-700 dark:bg-amber-950/20'
                                  : 'border-slate-200 dark:border-slate-700',
                              ].join(' ')}
                              data-job-line={lineKey(id, job.jobTitleId)}
                            >
                              <div className="w-full shrink-0 lg:w-56">
                                <p className="font-medium">{localized(job.name, locale)}</p>
                                <div className="mt-2 flex flex-col items-start gap-1">
                                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700 dark:bg-slate-800 dark:text-blue-300">
                                    {t('contracts.bulk.paperCount', { count: mine.size })}
                                  </span>
                                  <div className="flex gap-1">
                                    <Button size="sm" variant="ghost" onClick={() => setLine(id, job.jobTitleId, everyPaper(papers, mine))}>
                                      {t('contracts.candidate.selectAll')}
                                    </Button>
                                    <Button size="sm" variant="ghost" onClick={() => setLine(id, job.jobTitleId, [])}>
                                      {t('contracts.candidate.selectNone')}
                                    </Button>
                                  </div>
                                </div>
                              </div>
                              {tiles((key) => mine.has(key), (key, on) => toggle(id, job, key, on))}
                            </div>
                          );
                        })}
                        {!searching && free.length > 0 && (
                          <div className="flex flex-wrap items-center gap-2" data-department-add={id}>
                            <div className="w-full sm:w-72">
                              <Select
                                value={adding[id] ?? ''}
                                onChange={(e) => setAdding((current) => ({ ...current, [id]: e.target.value }))}
                                aria-label={t('contracts.jobPapers.addJob')}
                              >
                                <option value="">{t('contracts.jobPapers.addJob')}</option>
                                {free.map((job) => (
                                  <option key={job.jobTitleId} value={job.jobTitleId}>{localized(job.name, locale)}</option>
                                ))}
                              </Select>
                            </div>
                            <Button size="sm" variant="secondary" disabled={(adding[id] ?? '') === ''} onClick={() => addJob(id)}>
                              {t('contracts.jobPapers.add')}
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
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
