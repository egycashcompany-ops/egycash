// Upload the roster, see what it would do, then agree to it.
//
// THE PREVIEW IS NOT A COURTESY. One upload can add people, rewrite personal data and move staff
// between departments across the whole registry — thousands of records from one click, with no undo.
// So the file is read twice: once with `apply=false`, which writes nothing and reports exactly what
// it would write, and once for real only after somebody has looked at that and said yes.
//
// The same File object is posted both times, so the run cannot differ from the preview that was
// agreed to. Nothing is held on the server between them.
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { type RosterImportReportDto } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Button } from '../../../../../shared/ui/Button';
import { FileUpload } from '../../../../../shared/ui/FileUpload';
import { Spinner } from '../../../../../shared/ui/Spinner';
import { importEmployeeRoster } from '../api/employee-api';
import { rosterFieldLabel, visibleChanges } from '../lib/roster-fields';

const XLSX = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_MB = 20;

/** One number and what it counts. The four that decide whether somebody presses the button. */
const Count = ({ label, value, tone }: { label: string; value: number; tone: string }): JSX.Element => (
  <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
    <div className={`text-2xl font-semibold tabular-nums ${tone}`}>{value}</div>
    <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
  </div>
);

const Section = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): JSX.Element => (
  <section className="space-y-2">
    <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</h3>
    {children}
  </section>
);

export const RosterImportDialog = ({
  open,
  onClose,
  onApplied,
}: {
  open: boolean;
  onClose: () => void;
  /** The list is stale the moment an apply succeeds — the caller refetches. */
  onApplied: () => void;
}): JSX.Element => {
  const t = useT();
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<RosterImportReportDto | null>(null);

  const run = useMutation({
    mutationFn: ({ f, apply }: { f: File; apply: boolean }) => importEmployeeRoster(f, apply),
    onSuccess: (result) => {
      setReport(result);
      if (result.mode === 'applied') onApplied();
    },
  });

  const close = (): void => {
    setFile(null);
    setReport(null);
    run.reset();
    onClose();
  };

  const pick = (files: File[]): void => {
    const picked = files[0] ?? null;
    setFile(picked);
    setReport(null);
    run.reset();
    if (picked !== null) run.mutate({ f: picked, apply: false });
  };

  const applied = report?.mode === 'applied';
  const counts = report?.counts;
  // Nothing to agree to: the file matches the registry, so the apply button would write nothing.
  const nothingToDo =
    counts !== undefined && counts.imported === 0 && counts.updated === 0;

  const error = run.error;

  return (
    <Dialog
      open={open}
      onClose={close}
      size="lg"
      title={t('employees.roster.title')}
      description={t('employees.roster.subtitle')}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={close}>
            {applied ? t('common.close') : t('common.cancel')}
          </Button>
          {report !== null && !applied && !nothingToDo && (
            <Button
              onClick={() => {
                if (file !== null) run.mutate({ f: file, apply: true });
              }}
              disabled={run.isPending}
            >
              {t('employees.roster.apply')}
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-5">
        {report === null && !run.isPending && (
          <FileUpload accept={XLSX} maxSizeMb={MAX_MB} onFiles={pick} />
        )}

        {run.isPending && (
          <div className="flex items-center gap-3 py-6 text-sm text-slate-600 dark:text-slate-300">
            <Spinner />
            {t(run.variables?.apply === true ? 'employees.roster.applying' : 'employees.roster.reading')}
          </div>
        )}

        {error !== null && (
          <p className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200">
            {error instanceof Error ? error.message : String(error)}
          </p>
        )}

        {report !== null && counts !== undefined && (
          <div className="space-y-5">
            {/* Said before anything else: a preview has touched nothing, and must not read as done. */}
            <p
              className={
                applied
                  ? 'rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100'
                  : 'rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100'
              }
            >
              {t(applied ? 'employees.roster.appliedNotice' : 'employees.roster.previewNotice')}
            </p>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Count
                label={t('employees.roster.counts.added')}
                value={counts.imported}
                tone="text-emerald-600 dark:text-emerald-400"
              />
              <Count
                label={t('employees.roster.counts.updated')}
                value={counts.updated}
                tone="text-sky-600 dark:text-sky-400"
              />
              <Count
                label={t('employees.roster.counts.unchanged')}
                value={counts.unchanged}
                tone="text-slate-600 dark:text-slate-300"
              />
              <Count
                label={t('employees.roster.counts.failed')}
                value={counts.failed + report.rejected.length}
                tone="text-rose-600 dark:text-rose-400"
              />
            </div>

            {nothingToDo && !applied && (
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {t('employees.roster.nothingToDo')}
              </p>
            )}

            {report.sampled && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('employees.roster.sampled')}
              </p>
            )}

            {report.updates.length > 0 && (
              <Section title={t('employees.roster.changesTitle')}>
                <div className="max-h-64 overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-start text-xs">
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {report.updates.map((u) =>
                        visibleChanges(u.changes).map((c) => (
                          <tr key={`${u.code}:${c.path}`}>
                            <td className="whitespace-nowrap p-2 font-mono" dir="ltr">
                              {u.code}
                            </td>
                            <td className="p-2">{u.name}</td>
                            <td className="p-2 text-slate-500">{rosterFieldLabel(t, c.path)}</td>
                            <td className="p-2 text-slate-400 line-through">{c.from}</td>
                            <td className="p-2 font-medium">{c.to}</td>
                          </tr>
                        )),
                      )}
                    </tbody>
                  </table>
                </div>
              </Section>
            )}

            {report.additions.length > 0 && (
              <Section title={t('employees.roster.additionsTitle')}>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  {report.additions.map((a) => `${a.code} — ${a.name}`).join('، ')}
                </p>
              </Section>
            )}

            {report.refused.length > 0 && (
              <Section title={t('employees.roster.refusedTitle')}>
                <ul className="space-y-1 text-xs text-amber-800 dark:text-amber-200">
                  {report.refused.map((r) => (
                    <li key={`${r.code}:${r.path}`}>
                      <span className="font-mono" dir="ltr">
                        {r.code}
                      </span>{' '}
                      — {rosterFieldLabel(t, r.path)}: {r.reason}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {report.rejected.length > 0 && (
              <Section title={t('employees.roster.rejectedTitle')}>
                <ul className="max-h-40 space-y-1 overflow-auto text-xs text-rose-700 dark:text-rose-300">
                  {report.rejected.map((r) => (
                    <li key={`${r.sheet}:${r.rowNumber}`}>
                      {r.sheet} · {t('employees.roster.row')} {r.rowNumber}
                      {r.code === null ? '' : ` · ${r.code}`} — {r.reason}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {report.orgProblems.length > 0 && (
              <Section title={t('employees.roster.orgProblemsTitle')}>
                <ul className="space-y-1 text-xs text-amber-800 dark:text-amber-200">
                  {report.orgProblems.map((p) => (
                    <li key={p.what}>
                      {p.what} — {p.detail}
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
};
