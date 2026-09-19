// Upload the roster, see what it would do, then agree to it.
//
// THE PREVIEW IS NOT A COURTESY. One upload can add people, rewrite personal data and move staff
// between departments across the whole registry — thousands of records from one click, with no undo.
// So the file is read twice: once with `apply=false`, which writes nothing and reports exactly what
// it would write, and once for real only after somebody has looked at that and said yes.
//
// The same File object is posted both times, so the run cannot differ from the preview that was
// agreed to. Nothing is held on the server between them.
import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  type Locale,
  type RosterImportAction,
  type RosterImportReportDto,
} from '@ecms/contracts';
import { useAppSelector } from '../../../../../store';
import { localized } from '../../../../../shared/lib/format';
import { useT } from '../../../../../platform/localization/useT';
import { RosterValue } from '../lib/roster-value';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Button } from '../../../../../shared/ui/Button';
import { FileUpload } from '../../../../../shared/ui/FileUpload';
import { Spinner } from '../../../../../shared/ui/Spinner';
import { importEmployeeRoster } from '../api/employee-api';
import { rosterFieldLabel, visibleChanges } from '../lib/roster-fields';

const XLSX = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_MB = 20;

/**
 * What is selected when the dialog opens.
 *
 * Adding somebody the file names and the registry does not is nearly always right, and so is
 * recording that a leaver has left. Rewriting the personal data of two thousand people already on
 * file is not obviously right — it depends on whether this export is more current than the registry
 * — so it is offered rather than assumed, and the operator turns it on when they mean it.
 */
const DEFAULT_ACTIONS: readonly RosterImportAction[] = ['added', 'exited'];

/**
 * One number and what it counts.
 *
 * A card that maps to a KIND OF WRITE is a toggle — pressing it is how the operator says whether
 * that group should be applied. The other two are not: `unchanged` has nothing to write, and
 * `failed` cannot be written at all. They are drawn plainly, with no press affordance, because a
 * control that looks pressable and does nothing is worse than a number.
 */
const Count = ({
  label,
  value,
  tone,
  selected,
  onToggle,
}: {
  label: string;
  value: number;
  tone: string;
  selected?: boolean;
  onToggle?: () => void;
}): JSX.Element => {
  const body = (
    <>
      <div className={`text-2xl font-semibold tabular-nums ${selected === false ? 'opacity-40' : tone}`}>
        {value}
      </div>
      <div
        className={`text-xs ${
          selected === false
            ? 'text-slate-400 dark:text-slate-500'
            : 'text-slate-500 dark:text-slate-400'
        }`}
      >
        {label}
      </div>
    </>
  );
  if (onToggle === undefined) {
    return <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">{body}</div>;
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected === true}
      className={`rounded-lg border p-3 text-start transition-colors ${
        selected === true
          ? 'border-indigo-400 bg-indigo-50 dark:border-indigo-500 dark:bg-indigo-950'
          : 'border-slate-200 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700'
      }`}
    >
      {body}
    </button>
  );
};

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
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<RosterImportReportDto | null>(null);
  const [selected, setSelected] = useState<RosterImportAction[]>([...DEFAULT_ACTIONS]);
  const [confirmClose, setConfirmClose] = useState(false);

  const toggle = (action: RosterImportAction): void =>
    setSelected((current) =>
      current.includes(action) ? current.filter((a) => a !== action) : [...current, action],
    );

  const run = useMutation({
    mutationFn: ({ f, apply }: { f: File; apply: readonly RosterImportAction[] }) =>
      importEmployeeRoster(f, apply),
    onSuccess: (result) => {
      setReport(result);
      if (result.mode === 'applied') onApplied();
    },
  });

  const close = (): void => {
    setConfirmClose(false);
    setFile(null);
    setReport(null);
    setSelected([...DEFAULT_ACTIONS]);
    run.reset();
    onClose();
  };

  /**
   * WHILE IT IS WORKING, EVERY WAY OUT ASKS FIRST — the ×, Escape and Cancel alike.
   *
   * «لو دوست عليها برضو يقولى تنبيه ان اقفل ولا اسيبه يحمل». Blocking the backdrop stopped the
   * stray click; this is the other half, for the presses that are real but may still be a
   * reflex during a forty-second wait. Routing all three through one question is what keeps the
   * guard from having a back door: an X that asks and an Escape that does not would just move
   * the accident to the keyboard.
   *
   * Nothing is blocked. The question has a «close anyway» and it means it.
   */
  const requestClose = (): void => {
    if (run.isPending) {
      setConfirmClose(true);
      return;
    }
    close();
  };

  // The question is about a wait that is still happening. Once it is over the preview is sitting
  // behind this box, so the box goes rather than asking about something already finished.
  useEffect(() => {
    if (!run.isPending) setConfirmClose(false);
  }, [run.isPending]);

  const pick = (files: File[]): void => {
    const picked = files[0] ?? null;
    setFile(picked);
    setReport(null);
    run.reset();
    if (picked !== null) run.mutate({ f: picked, apply: [] });
  };

  const applied = report?.mode === 'applied';
  const counts = report?.counts;
  /** How many people each selectable group would actually write. */
  const sizeOf = (action: RosterImportAction): number =>
    counts === undefined
      ? 0
      : action === 'added'
        ? counts.imported
        : action === 'updated'
          ? counts.updated
          : counts.exits;
  // Nothing to agree to — either the file matches the registry, or every group that differs has
  // been turned off. Both mean the button would write nothing, so it is not offered.
  const selectedTotal = selected.reduce((sum, a) => sum + sizeOf(a), 0);
  const nothingToDo = counts !== undefined && selectedTotal === 0;

  const error = run.error;

  return (
    <Dialog
      open={open}
      onClose={requestClose}
      size="lg"
      // «انا عاوز لما ادوس على الاكس بس يقفل مش اى ميس كليك يقفل التاب». This dialog held the
      // longest-running thing in the product: the file is read and compared against 2,600 records
      // while a spinner turns, and one stray click on the backdrop — or one tap beside the panel
      // on a phone — threw the whole thing away. What was lost was not a form: it was a preview
      // somebody was part-way through reading, the only chance to see what an upload would write
      // before agreeing to it, and getting it back meant uploading and waiting all over again.
      //
      // The two deliberate ways out are unchanged: the × and Escape. Neither is reachable by
      // accident, which is the whole distinction this flag draws.
      dismissOnOutsideClick={false}
      title={t('employees.roster.title')}
      description={t('employees.roster.subtitle')}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={requestClose}>
            {applied ? t('common.close') : t('common.cancel')}
          </Button>
          {report !== null && !applied && !nothingToDo && (
            <Button
              onClick={() => {
                if (file !== null) run.mutate({ f: file, apply: selected });
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
            {t(
              (run.variables?.apply.length ?? 0) > 0
                ? 'employees.roster.applying'
                : 'employees.roster.reading',
            )}
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

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Count
                label={t('employees.roster.counts.added')}
                value={counts.imported}
                tone="text-emerald-600 dark:text-emerald-400"
                selected={selected.includes('added')}
                {...(applied ? {} : { onToggle: () => toggle('added') })}
              />
              <Count
                label={t('employees.roster.counts.exits')}
                value={counts.exits}
                tone="text-amber-600 dark:text-amber-400"
                selected={selected.includes('exited')}
                {...(applied ? {} : { onToggle: () => toggle('exited') })}
              />
              <Count
                label={t('employees.roster.counts.updated')}
                value={counts.updated}
                tone="text-sky-600 dark:text-sky-400"
                selected={selected.includes('updated')}
                {...(applied ? {} : { onToggle: () => toggle('updated') })}
              />
              {/* Neither of these is a choice: one has nothing to write, the other cannot be. */}
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

            {!applied && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('employees.roster.pickHint')}
              </p>
            )}

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

            {report.exits.length > 0 && (
              <Section title={t('employees.roster.exitsTitle')}>
                <div className="max-h-48 overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-start text-xs">
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {report.exits.map((e) => (
                        <tr key={e.code}>
                          <td className="whitespace-nowrap p-2 font-mono" dir="ltr">
                            {e.code}
                          </td>
                          <td className="p-2">{e.name}</td>
                          <td className="whitespace-nowrap p-2 tabular-nums text-slate-500" dir="ltr">
                            {e.effectiveDate}
                          </td>
                          <td className="p-2 text-slate-500">{e.reason ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
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
                            <td className="p-2 text-slate-400 line-through">
                              <RosterValue value={c.from} t={t} locale={locale} />
                            </td>
                            <td className="p-2 font-medium">
                              <RosterValue value={c.to} t={t} locale={locale} />
                            </td>
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
                <div className="max-h-48 overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-start text-xs">
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {report.additions.map((a) => (
                        <tr key={a.code}>
                          <td className="whitespace-nowrap p-2 font-mono" dir="ltr">
                            {a.code}
                          </td>
                          <td className="p-2">{a.name}</td>
                          {/*
                            Said plainly, because most of them are leavers: the workbook's larger
                            sheet is Resignation, and somebody it names joins the registry already
                            exited. Without this the reader goes looking for them on a list that
                            hides exited people by default, and concludes they were never added.
                          */}
                          <td className="whitespace-nowrap p-2 text-end">
                            {a.serving ? (
                              <span className="text-emerald-600 dark:text-emerald-400">
                                {t('employees.roster.addedServing')}
                              </span>
                            ) : (
                              <span className="text-slate-500 dark:text-slate-400">
                                {t('employees.roster.addedExited')}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {report.additions.some((a) => !a.serving) && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {t('employees.roster.addedExitedHint')}
                  </p>
                )}
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
                      — {rosterFieldLabel(t, r.path)}: {localized(r.reason, locale)}
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
                      {t(`employees.roster.sheet.${r.sheet}`)} · {t('employees.roster.row')}{' '}
                      {r.rowNumber}
                      {r.code === null ? '' : ` · ${r.code}`} — {localized(r.reason, locale)}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {report.orgProblems.length > 0 && (
              <Section title={t('employees.roster.orgProblemsTitle')}>
                <ul className="space-y-1 text-xs text-amber-800 dark:text-amber-200">
                  {report.orgProblems.map((p) => (
                    <li key={`${p.what}:${p.detail.en}`}>
                      {t(`employees.roster.orgWhat.${p.what}`)} — {localized(p.detail, locale)}
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </div>
        )}
      </div>

      {/*
        THE TEXT TELLS THE TRUTH ABOUT WHAT CLOSING DOES, and the two cases are not the same fact.

        While the PREVIEW is being read nothing has been written, so closing costs the wait and
        nothing else. While an APPLY is running the request is already with the server and closing
        this box does NOT call it back — the records keep being written, and all that is lost is
        seeing how it went. Saying «nothing will happen» there would be a lie about 2,600 people.
      */}
      {confirmClose && (
        <Dialog
          open
          onClose={() => {
            setConfirmClose(false);
          }}
          // `md`, not `sm`: the two answers now name what they do, and two named answers do not
          // sit side by side in the narrowest box on a desktop. The body is still one paragraph.
          size="md"
          title={t('employees.roster.closeWhileBusy.title')}
          footer={
            // A BUTTON THAT SAYS WHAT IT DOES IS A LONGER BUTTON. `flex-wrap` is what pays for
            // the longer labels on a phone, where the box is as wide as the hand holding it: the
            // two take a row each instead of being squeezed until the words break inside a
            // fixed-height button.
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setConfirmClose(false);
                }}
              >
                {t('employees.roster.closeWhileBusy.keep')}
              </Button>
              <Button variant="danger" onClick={close}>
                {t('employees.roster.closeWhileBusy.close')}
              </Button>
            </div>
          }
        >
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t(
              (run.variables?.apply.length ?? 0) > 0
                ? 'employees.roster.closeWhileBusy.applying'
                : 'employees.roster.closeWhileBusy.reading',
            )}
          </p>
        </Dialog>
      )}
    </Dialog>
  );
};
