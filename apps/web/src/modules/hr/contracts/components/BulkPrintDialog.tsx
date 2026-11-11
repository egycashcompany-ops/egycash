// «طباعة لكل المحدد» on «جاهزون للتعيين» (A28) — «لو معايا 20 شخص و عاوز اطبعلهم كلهم فنفس الوقت …
// هيظهرلي pop up تكون فيها الاشخاص اللي عاوز اطبعلهم و جمبها ال toggle buttoms بتاعت النمازج …
// اعلم او اختار براحتي … يطبعلي ليهم كل المتحدد عليه من الاشخاص و ال نمازج علي حسب وظيفتهم».
//
// The people ticked, each with their own job; beside them every paper any of them prints, as the
// same tiles as «عقد جديد», each saying for how many it applies — a job's card prints for that job's
// people only, the weapon declaration for crew leaders only. «تأكيد الطباعة» prints ONE document,
// person after person; each print is recorded as on the person's own page (their code kept, so
// «تعيين» opens there).
import { useEffect, useMemo, useState } from 'react';
import { type CandidateBulkPersonDto, type CandidatePaperGroup, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Button } from '../../../../shared/ui/Button';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { localized } from '../../../../shared/lib/format';
import { openPrintWindow, writePrintWindow } from '../../../../shared/lib/print-window';
import { useBulkOpenCandidates, useBulkRenderCandidates } from '../api/contract-queries';
import { PaperTile } from './PaperTile';

const GROUP_ORDER: CandidatePaperGroup[] = ['contract', 'everyJob', 'thisJob'];

/** Every paper any of the people prints — once each, in print order, with who it is for. */
export const papersOfPeople = (
  people: readonly CandidateBulkPersonDto[],
): { key: string; name: { ar: string; en: string }; kind: 'contract' | 'form'; group: CandidatePaperGroup; for: string[] }[] => {
  const byKey = new Map<string, { key: string; name: { ar: string; en: string }; kind: 'contract' | 'form'; group: CandidatePaperGroup; for: string[]; seen: number }>();
  let seen = 0;
  for (const person of people) {
    for (const paper of person.papers) {
      const known = byKey.get(paper.key);
      if (known === undefined) byKey.set(paper.key, { ...paper, for: [person.offerId], seen: seen++ });
      else known.for.push(person.offerId);
    }
  }
  return [...byKey.values()]
    .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || a.seen - b.seen)
    .map(({ seen: _seen, ...paper }) => paper);
};

/**
 * The papers ticked when the popup opens: every one, but one the people's jobs are only offered
 * unticked (the cash-in-transit specialist's weapon declaration) — ticked when it is a usual paper
 * for any of them.
 */
export const startingChoice = (people: readonly CandidateBulkPersonDto[]): Set<string> =>
  new Set(people.flatMap((person) => person.papers.filter((paper) => !paper.optional).map((paper) => paper.key)));

export const BulkPrintDialog = ({
  offerIds,
  open,
  onClose,
  onPrinted,
}: {
  offerIds: string[];
  open: boolean;
  onClose: () => void;
  /** After a print — the caller clears the selection. */
  onPrinted: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const load = useBulkOpenCandidates();
  const render = useBulkRenderCandidates();
  const [people, setPeople] = useState<CandidateBulkPersonDto[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  // The people and their papers, each time the dialog opens, the usual papers chosen to start with.
  useEffect(() => {
    if (!open) return;
    setPeople([]);
    load
      .mutateAsync(offerIds)
      .then((loaded) => {
        setPeople(loaded);
        setChosen(startingChoice(loaded));
      })
      .catch(() => undefined);
  }, [open, offerIds.join(',')]);

  const papers = useMemo(() => papersOfPeople(people), [people]);
  const printable = people.filter((p) => p.error === null);
  const papersFor = (person: CandidateBulkPersonDto): number => person.papers.filter((paper) => chosen.has(paper.key)).length;
  const ready = printable.some((person) => papersFor(person) > 0);

  const toggle = (key: string, on: boolean): void =>
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const confirm = async (): Promise<void> => {
    // The tab opens on the click itself — one opened after the request returns is a blocked popup.
    const win = openPrintWindow(t('hiringPack.preparing'));
    if (win === null) {
      toast.error(t('hiringPack.popupBlocked'));
      return;
    }
    try {
      const out = await render.mutateAsync({
        offerIds: printable.map((p) => p.offerId),
        keys: papers.filter((paper) => chosen.has(paper.key)).map((paper) => paper.key),
      });
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
      size="xl"
      title={t('contracts.bulk.title', { count: offerIds.length })}
      description={t('contracts.bulk.hint')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button disabled={!ready} loading={render.isPending} onClick={() => void confirm()} data-bulk-confirm>
            {t('contracts.bulk.confirm')}
          </Button>
        </>
      }
    >
      {load.isPending || people.length === 0 ? (
        <p className="text-sm text-slate-500">{t('common.loading')}</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <section data-bulk-people>
            <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              {t('contracts.bulk.people', { count: printable.length })}
            </h3>
            <ul className="max-h-[55vh] divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
              {people.map((person) => (
                <li key={person.offerId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{person.applicantName === '' ? '—' : person.applicantName}</p>
                    <p className="text-xs text-slate-500">
                      {person.jobTitle === null ? '—' : localized(person.jobTitle, locale)}
                      {person.offerCode !== null && (
                        <>
                          <span className="mx-1.5" aria-hidden="true">·</span>
                          <span className="font-mono" dir="ltr">{person.offerCode}</span>
                        </>
                      )}
                    </p>
                  </div>
                  {person.error === null ? (
                    <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700 dark:bg-slate-800 dark:text-blue-300">
                      {t('contracts.bulk.paperCount', { count: papersFor(person) })}
                    </span>
                  ) : (
                    <span className="shrink-0 text-xs text-red-600">{t('contracts.bulk.cannot')}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section data-bulk-papers>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t('contracts.bulk.papers')}</h3>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setChosen(new Set(papers.map((p) => p.key)))}>
                  {t('contracts.candidate.selectAll')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setChosen(new Set())}>
                  {t('contracts.candidate.selectNone')}
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {papers.map((paper) => (
                <PaperTile
                  key={paper.key}
                  paperKey={paper.key}
                  name={localized(paper.name, locale)}
                  kind={paper.kind}
                  checked={chosen.has(paper.key)}
                  onToggle={(on) => toggle(paper.key, on)}
                  caption={
                    paper.for.length === printable.length
                      ? t('contracts.bulk.forAll')
                      : t('contracts.bulk.forSome', { count: paper.for.length })
                  }
                />
              ))}
            </div>
          </section>
        </div>
      )}
    </Dialog>
  );
};
