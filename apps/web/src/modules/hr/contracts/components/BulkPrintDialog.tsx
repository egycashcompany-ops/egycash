// «طباعة لكل المحدد» on «جاهزون للتعيين» (A28) — «لو معايا 20 شخص و عاوز اطبعلهم كلهم فنفس الوقت …
// هيظهرلي pop up تكون فيها الاشخاص اللي عاوز اطبعلهم و جمبها ال toggle buttoms بتاعت النمازج».
//
// EACH PERSON ON A LINE OF THEIR OWN — «عاوز لكل واحد منهم النمازج لكل واحد منفصل عن التاني مش كله
// مع بعض فنفس الاختيارات لا كل واحد ليه line جواه النمازج و العقود الخاصه بيه علي حسب وظيفتو». The
// line holds that person's name and job, then EVERY paper as a tile — «هنزود النمازج كلها مع mark علي
// حسب الوظيفه و الباقي مطفي»: their own job's papers (the contract, every job's forms, their job's
// card and declarations, as «مستندات الوظائف» sets them) ticked, every other paper there unticked, to
// add for that person alone. «تأكيد الطباعة» prints ONE document, person after person, each with what
// was ticked on their line; each print is recorded as on the person's own page (their code kept, so
// «تعيين» opens there).
import { useEffect, useState } from 'react';
import { type CandidateBulkPersonDto, type Locale, type RenderCandidateBulk } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Button } from '../../../../shared/ui/Button';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { localized } from '../../../../shared/lib/format';
import { openPrintWindow, writePrintWindow } from '../../../../shared/lib/print-window';
import { useBulkOpenCandidates, useBulkRenderCandidates } from '../api/contract-queries';
import { PaperTile } from './PaperTile';

/** What is ticked on each person's line, by offer. */
export type BulkChoice = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * Each person's line as the popup opens: the papers of their job ticked — but one their job is only
 * offered unticked (the cash-in-transit specialist's weapon declaration) — and every other paper
 * (`other`) there and unticked.
 */
export const startingChoice = (people: readonly CandidateBulkPersonDto[]): BulkChoice =>
  new Map(
    people.map((person) => [
      person.offerId,
      new Set(person.papers.filter((p) => p.group !== 'other' && !p.optional).map((p) => p.key)),
    ]),
  );

/** The print request: each person who can be printed for with what is ticked on their line, in print order. */
export const printRequest = (people: readonly CandidateBulkPersonDto[], chosen: BulkChoice): RenderCandidateBulk => ({
  people: people
    .filter((person) => person.error === null)
    .map((person) => ({
      offerId: person.offerId,
      keys: person.papers.map((p) => p.key).filter((key) => chosen.get(person.offerId)?.has(key) === true),
    }))
    .filter((line) => line.keys.length > 0),
});

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
  const [chosen, setChosen] = useState<BulkChoice>(new Map());

  // The people and their papers, each time the dialog opens, each line as `startingChoice` sets it.
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

  const printable = people.filter((p) => p.error === null);
  const request = printRequest(people, chosen);
  const ready = request.people.length > 0;

  /** One person's line: one paper on or off, or all of them / none. */
  const setLine = (offerId: string, keys: Iterable<string>): void =>
    setChosen((current) => new Map(current).set(offerId, new Set(keys)));
  const toggle = (offerId: string, key: string, on: boolean): void => {
    const next = new Set(chosen.get(offerId) ?? []);
    if (on) next.add(key);
    else next.delete(key);
    setLine(offerId, next);
  };
  /** Everybody's lines at once. */
  const setAll = (on: boolean): void =>
    setChosen(new Map(people.map((person) => [person.offerId, new Set(on ? person.papers.map((p) => p.key) : [])])));

  const confirm = async (): Promise<void> => {
    // The tab opens on the click itself — one opened after the request returns is a blocked popup.
    const win = openPrintWindow(t('hiringPack.preparing'));
    if (win === null) {
      toast.error(t('hiringPack.popupBlocked'));
      return;
    }
    try {
      const out = await render.mutateAsync(request);
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
              const mine = chosen.get(person.offerId) ?? new Set<string>();
              return (
                <li
                  key={person.offerId}
                  className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3 lg:flex-row lg:items-start dark:border-slate-700"
                  data-bulk-person={person.offerId}
                >
                  <div className="w-full shrink-0 lg:w-60">
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
                    {person.error === null ? (
                      <div className="mt-2 flex flex-col items-start gap-1">
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700 dark:bg-slate-800 dark:text-blue-300">
                          {t('contracts.bulk.paperCount', { count: person.papers.filter((p) => mine.has(p.key)).length })}
                        </span>
                        <div className="flex flex-wrap gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setLine(person.offerId, startingChoice([person]).get(person.offerId) ?? [])}>
                            {t('contracts.candidate.selectJob')}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setLine(person.offerId, person.papers.map((p) => p.key))}>
                            {t('contracts.candidate.selectAll')}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setLine(person.offerId, [])}>
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
                          onToggle={(on) => toggle(person.offerId, paper.key, on)}
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
