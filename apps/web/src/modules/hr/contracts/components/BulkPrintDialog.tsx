// «طباعة لكل المحدد» on «جاهزون للتعيين» (A28) — «لو معايا 20 شخص و عاوز اطبعلهم كلهم فنفس الوقت …
// هيظهرلي pop up تكون فيها الاشخاص اللي عاوز اطبعلهم و جمبها ال toggle buttoms بتاعت النمازج».
//
// EACH PERSON ON A LINE OF THEIR OWN — «عاوز لكل واحد منهم النمازج لكل واحد منفصل عن التاني مش كله
// مع بعض فنفس الاختيارات لا كل واحد ليه line جواه النمازج و العقود الخاصه بيه علي حسب وظيفتو». The
// line holds that person's name and job, then the tiles of THEIR papers only — those of their
// department and job, as «مستندات الوظائف» sets them («النمازج المخصصه بس للاداره او الوظائف هي اللي
// هتكون موجوده») — ticked for that person alone. «تأكيد الطباعة» prints ONE document, person after
// person, each with what was ticked on their line; each print is recorded as on the person's own
// page (their code kept, so «تعيين» opens there).
import { useEffect, useState } from 'react';
import {
  type CandidateBulkPersonDto,
  type EmployeeBulkPersonDto,
  type JobPaperDto,
  type Locale,
  type RenderCandidateBulk,
  type RenderEmployeeBulk,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Button } from '../../../../shared/ui/Button';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { localized } from '../../../../shared/lib/format';
import { openPrintWindow, writePrintWindow } from '../../../../shared/lib/print-window';
import {
  useBulkOpenCandidates,
  useBulkOpenEmployees,
  useBulkRenderCandidates,
  useBulkRenderEmployees,
} from '../api/contract-queries';
import { PaperTile } from './PaperTile';

/**
 * One line of the popup, whoever it is for: a candidate on «جاهزون للتعيين» (by offer), or an
 * employee on «المعينون» (by employee). The popup is the same for both.
 */
export interface BulkPerson {
  id: string;
  name: string;
  /** The offer's number, or the employee's code. */
  code: string | null;
  jobTitle: { ar: string; en: string } | null;
  papers: JobPaperDto[];
  error: string | null;
}

export const candidatePerson = (person: CandidateBulkPersonDto): BulkPerson => ({
  id: person.offerId,
  name: person.applicantName,
  code: person.offerCode,
  jobTitle: person.jobTitle,
  papers: person.papers,
  error: person.error,
});

export const employeePerson = (person: EmployeeBulkPersonDto): BulkPerson => ({
  id: person.employeeId,
  name: person.employeeName,
  code: person.employeeCode,
  jobTitle: person.jobTitle,
  papers: person.papers,
  error: person.error,
});

/** What is ticked on each person's line, by person. */
export type BulkChoice = ReadonlyMap<string, ReadonlySet<string>>;

/** Each person's line as the popup opens: their papers ticked, but one only offered unticked. */
export const startingChoice = (people: readonly BulkPerson[]): BulkChoice =>
  new Map(people.map((person) => [person.id, new Set(person.papers.filter((p) => !p.optional).map((p) => p.key))]));

/** Each person who can be printed for with what is ticked on their line, in print order. */
export const printLines = (people: readonly BulkPerson[], chosen: BulkChoice): { id: string; keys: string[] }[] =>
  people
    .filter((person) => person.error === null)
    .map((person) => ({
      id: person.id,
      keys: person.papers.map((p) => p.key).filter((key) => chosen.get(person.id)?.has(key) === true),
    }))
    .filter((line) => line.keys.length > 0);

/** The candidates' print request («جاهزون للتعيين»). */
export const printRequest = (people: readonly BulkPerson[], chosen: BulkChoice): RenderCandidateBulk => ({
  people: printLines(people, chosen).map((line) => ({ offerId: line.id, keys: line.keys })),
});

/** The employees' print request («المعينون»). */
export const employeePrintRequest = (people: readonly BulkPerson[], chosen: BulkChoice): RenderEmployeeBulk => ({
  people: printLines(people, chosen).map((line) => ({ employeeId: line.id, keys: line.keys })),
});

export const BulkPrintDialog = ({
  ids,
  source,
  open,
  onClose,
  onPrinted,
}: {
  /** The ticked rows: offers on «جاهزون للتعيين», employees on «المعينون». */
  ids: string[];
  source: 'candidates' | 'employees';
  open: boolean;
  onClose: () => void;
  /** After a print — the caller clears the selection. */
  onPrinted: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const openCandidates = useBulkOpenCandidates();
  const renderCandidates = useBulkRenderCandidates();
  const openEmployees = useBulkOpenEmployees();
  const renderEmployees = useBulkRenderEmployees();
  const employees = source === 'employees';
  const loading = employees ? openEmployees.isPending : openCandidates.isPending;
  const rendering = employees ? renderEmployees.isPending : renderCandidates.isPending;
  const [people, setPeople] = useState<BulkPerson[]>([]);
  const [chosen, setChosen] = useState<BulkChoice>(new Map());

  // The people and their papers, each time the dialog opens, each line as `startingChoice` sets it.
  useEffect(() => {
    if (!open) return;
    setPeople([]);
    const loading = employees
      ? openEmployees.mutateAsync(ids).then((rows) => rows.map(employeePerson))
      : openCandidates.mutateAsync(ids).then((rows) => rows.map(candidatePerson));
    loading
      .then((loaded) => {
        setPeople(loaded);
        setChosen(startingChoice(loaded));
      })
      .catch(() => undefined);
  }, [open, source, ids.join(',')]);

  const printable = people.filter((p) => p.error === null);
  const ready = printLines(people, chosen).length > 0;

  /** One person's line: one paper on or off, or all of them / none. */
  const setLine = (id: string, keys: Iterable<string>): void =>
    setChosen((current) => new Map(current).set(id, new Set(keys)));
  const toggle = (id: string, key: string, on: boolean): void => {
    const next = new Set(chosen.get(id) ?? []);
    if (on) next.add(key);
    else next.delete(key);
    setLine(id, next);
  };
  /** Everybody's lines at once. */
  const setAll = (on: boolean): void =>
    setChosen(new Map(people.map((person) => [person.id, new Set(on ? person.papers.map((p) => p.key) : [])])));

  const confirm = async (): Promise<void> => {
    // The tab opens on the click itself — one opened after the request returns is a blocked popup.
    const win = openPrintWindow(t('hiringPack.preparing'));
    if (win === null) {
      toast.error(t('hiringPack.popupBlocked'));
      return;
    }
    try {
      const out = employees
        ? await renderEmployees.mutateAsync(employeePrintRequest(people, chosen))
        : await renderCandidates.mutateAsync(printRequest(people, chosen));
      const done = out.results.filter((r) => r.error === null);
      if (out.html === '') win.close();
      else writePrintWindow(win, out.html);
      toast.success(t('contracts.bulk.printed', { count: done.length }));
      const skipped = out.results.length - done.length;
      if (skipped > 0) toast.warning(t('contracts.bulk.skipped', { count: skipped }));
      onPrinted();
      onClose();
    } catch {
      win.close(); // the error itself is surfaced globally
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="full"
      title={t('contracts.bulk.title', { count: ids.length })}
      description={t('contracts.bulk.hint')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button disabled={!ready} loading={rendering} onClick={() => void confirm()} data-bulk-confirm>
            {t('contracts.bulk.confirm')}
          </Button>
        </>
      }
    >
      {loading || people.length === 0 ? (
        <p className="text-sm text-slate-500">{t('common.loading')}</p>
      ) : (
        <section data-bulk-people>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              {t('contracts.bulk.people', { count: printable.length })}
            </h3>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => setAll(true)} data-bulk-all>
                {t('contracts.bulk.everyoneAll')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAll(false)} data-bulk-none>
                {t('contracts.bulk.everyoneNone')}
              </Button>
            </div>
          </div>
          <ul className="max-h-[65vh] space-y-3 overflow-y-auto pe-1">
            {people.map((person) => {
              const mine = chosen.get(person.id) ?? new Set<string>();
              return (
                <li
                  key={person.id}
                  className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3 lg:flex-row lg:items-start dark:border-slate-700"
                  data-bulk-person={person.id}
                >
                  <div className="w-full shrink-0 lg:w-60">
                    <p className="truncate font-medium">{person.name === '' ? '—' : person.name}</p>
                    <p className="text-xs text-slate-500">
                      {person.jobTitle === null ? '—' : localized(person.jobTitle, locale)}
                      {person.code !== null && (
                        <>
                          <span className="mx-1.5" aria-hidden="true">·</span>
                          <span className="font-mono" dir="ltr">{person.code}</span>
                        </>
                      )}
                    </p>
                    {person.error === null ? (
                      <div className="mt-2 flex flex-col items-start gap-1">
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700 dark:bg-slate-800 dark:text-blue-300">
                          {t('contracts.bulk.paperCount', { count: person.papers.filter((p) => mine.has(p.key)).length })}
                        </span>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setLine(person.id, person.papers.map((p) => p.key))}>
                            {t('contracts.candidate.selectAll')}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setLine(person.id, [])}>
                            {t('contracts.candidate.selectNone')}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-red-600">{t('contracts.bulk.cannot')}</p>
                    )}
                  </div>
                  {person.error === null && (
                    <div className="flex flex-wrap gap-2" data-bulk-papers>
                      {person.papers.map((paper) => (
                        <PaperTile
                          key={paper.key}
                          paperKey={paper.key}
                          name={localized(paper.name, locale)}
                          kind={paper.kind}
                          checked={mine.has(paper.key)}
                          onToggle={(on) => toggle(person.id, paper.key, on)}
                        />
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </Dialog>
  );
};
