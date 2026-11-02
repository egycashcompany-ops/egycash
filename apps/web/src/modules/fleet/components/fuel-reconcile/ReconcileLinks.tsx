// «ربط الكروت بالسيارات» (6b), between the balance table and the folds: where the sheet's code
// column puts each matched card, against where the system has it, in four groups — on a car in the
// sheet and on none in the system («تحديث؟»), on another car («نقل؟», a swapped pair together), on
// no car in the sheet («فك؟»), and a code the system does not know (the car picker and «تذكّر هذا
// الكود»). Each row shows from → to, the chassis in the card's name as evidence (✓ / ⚠), and its
// unit's ✓ / ✗. Nothing is automatic: every change is the owner's, row by row, and a ✓ leaves a
// «نُقل من … إلى … — شيت الشركة» line in «سجل الكارت». The pair waiting for the card-number repair
// is shown with its ✓ off («ضمن تصحيح الأرقام»); its ✗ stays.
//
// The grouping, the evidence and the bodies are pure (`lib/fuel-reconcile-links.ts`); the write is
// the page's (`onDecide`), so a refusal reaches the whole screen.
import { Fragment, useState, type ReactNode } from 'react';
import {
  type DecideFleetFuelLinks,
  type FleetFuelCardDto,
  type FleetFuelLinkKind,
  type FleetFuelLinkResultDto,
  type FleetFuelReconcileDecision,
  type FleetFuelReconcileDto,
  type FleetFuelReconcileLinkDto,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { cn } from '../../../../shared/lib/cn';
import { BoardIcon, NUM, PATH } from '../FuelCardBoard';
import { carBoxClass } from '../FuelCardDialog';
import { MOVES_CHIP, SECTION_CARD, SECTION_STRIP } from '../custody-board-looks';
import { TITLE } from '../custody-dashboard-parts';
import { VehicleCodeCombobox } from '../VehicleCodeCombobox';
import { dots } from '../../lib/fuel-reconcile';
import {
  cardAfterLink,
  chassisOfName,
  chassisToneOf,
  isSwap,
  linkBodyOf,
  linkDecisionOf,
  linkGroupsOf,
  placeOfCard,
  unitInRepair,
  unitPicked,
  type LinkGroup,
  type LinkPick,
  type LinkUnit,
} from '../../lib/fuel-reconcile-links';
import { useReconcileCount } from '../../lib/fuel-reconcile-words';
import { HistoryButton, LinkPlace, MOVED_ICON, Place } from './reconcile-cells';

const L = 'fleet.fuelCards.reconcile.links.';

const GROUP_TONE: Record<FleetFuelLinkKind, string> = {
  attach:
    'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300',
  move: 'border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-300',
  detach:
    'border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300',
  unknownCode:
    'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300',
};
/** A ✓'s word per group: «تحديث», «نقل», «فك من السيارة». */
const APPLY_WORD: Record<FleetFuelLinkKind, string> = {
  attach: 'update',
  move: 'move',
  detach: 'detach',
  unknownCode: 'update',
};

/** The chassis in the card's name, against the car it belongs to. */
const Evidence = ({ link }: { link: FleetFuelReconcileLinkDto }): JSX.Element => {
  const t = useT();
  const tone = chassisToneOf(link);
  return (
    <span className="inline-flex flex-col items-center gap-0.5" data-recon-evidence={tone}>
      <span dir="ltr" className={cn(NUM, 'text-[12px] text-slate-500 dark:text-slate-400')}>
        {chassisOfName(link.card.name)}
      </span>
      {tone === 'none' ? (
        <span className="text-[12px] font-semibold text-slate-500 dark:text-slate-400">
          {t(`${L}chassisNone`)}
        </span>
      ) : (
        <span
          className={cn(
            'inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[12px] font-bold',
            tone === 'agrees'
              ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
              : tone === 'info'
                ? 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'
                : 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300',
          )}
        >
          {tone === 'agrees' ? (
            '✓'
          ) : tone === 'info' ? null : (
            <BoardIcon d={PATH.warn} className="h-3 w-3" />
          )}
          {t(`${L}chassisCar`, { code: link.chassisCar ?? '' })}
          {(tone === 'agrees' || tone === 'differs') && (
            <span className="font-semibold opacity-80">
              · {t(tone === 'agrees' ? `${L}chassisAgreesNote` : `${L}chassisDiffersNote`)}
            </span>
          )}
        </span>
      )}
    </span>
  );
};

const DECIDE =
  'inline-flex h-8 items-center justify-center gap-1 whitespace-nowrap rounded-lg border px-2.5 text-[13px] font-bold transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40';
const APPLY =
  'border-emerald-500/40 bg-emerald-600/15 text-emerald-700 hover:bg-emerald-600/25 dark:text-emerald-400';
const KEEP = 'border-red-500/40 bg-red-600/15 text-red-700 hover:bg-red-600/25 dark:text-red-400';

const TH = 'whitespace-nowrap px-3 py-2.5 text-[13px] font-semibold';
const TD = 'px-3 py-2 text-sm text-slate-700 dark:text-slate-200';

export const ReconcileLinks = ({
  result,
  results,
  refused,
  mayDecide,
  busy,
  onDecide,
  onHistory,
}: {
  result: FleetFuelReconcileDto;
  /** The server's answers on this screen, by card id (lower case). */
  results: Readonly<Record<string, FleetFuelLinkResultDto>>;
  /** Cards refused because their car changed after the read — ✓ off, the sheet to be read again. */
  refused: ReadonlySet<string>;
  /** `fleetFuelCard.edit` — without it ✓ / ✗ are disabled. */
  mayDecide: boolean;
  busy: boolean;
  onDecide: (body: DecideFleetFuelLinks) => void;
  /** «سجل الكارت» of a card once its row is decided — the card as it stands after it. */
  onHistory: (card: FleetFuelCardDto) => void;
}): JSX.Element | null => {
  const t = useT();
  const count = useReconcileCount();
  const [picks, setPicks] = useState<Record<string, LinkPick>>({});
  const codeColumn = result.layout.find((column) => column.role === 'code');
  // A sheet without a car column says so in one line; an old session (no layout) says nothing.
  if (!result.carColumn) {
    return result.layout.length === 0 ? null : (
      <p
        data-recon-links="none"
        className="flex items-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-500 dark:border-slate-700 dark:bg-[#111827] dark:text-slate-400"
      >
        <BoardIcon d={PATH.link} className="h-3.5 w-3.5" />
        {t(`${L}noCarColumn`)}
      </p>
    );
  }
  if (result.links.length === 0) return null;
  const groups = linkGroupsOf(result.links);
  const cards = groups.reduce((sum, group) => sum + group.cards, 0);
  const idOf = (link: FleetFuelReconcileLinkDto): string => link.card.id.toLowerCase();
  const pickOf = (link: FleetFuelReconcileLinkDto): LinkPick =>
    picks[idOf(link)] ?? { vehicleId: '', remember: true };
  const setPick = (link: FleetFuelReconcileLinkDto, next: Partial<LinkPick>): void =>
    setPicks((now) => ({ ...now, [idOf(link)]: { ...pickOf(link), ...next } }));
  const placeWords = (link: FleetFuelReconcileLinkDto, which: 'card' | 'to'): string => {
    const place = which === 'to' && link.to !== null ? link.to : placeOfCard(link.card);
    return place.vehicleCode !== null
      ? t(`${L}placeCar`, { code: place.vehicleCode })
      : t(`${L}placeLabel`, { label: place.label ?? '—' });
  };

  /** Where the sheet puts the card: its place, or for an unknown code the picker. */
  const sheetPlace = (link: FleetFuelReconcileLinkDto): ReactNode =>
    link.kind === 'unknownCode' ? (
      <span className="flex flex-col items-stretch gap-1.5" data-recon-link-pick={link.card.id}>
        <span
          className={cn('w-44', carBoxClass(false), '[&_input]:!py-1.5 [&_input]:!text-[13px]')}
        >
          <VehicleCodeCombobox
            value={pickOf(link).vehicleId}
            onChange={(vehicleId) => setPick(link, { vehicleId })}
            ariaLabel={t(`${L}pickCar`)}
            placeholder={t(`${L}pickCar`)}
            density="tight"
          />
        </span>
        <label className="inline-flex items-center gap-1.5 text-[12px] font-bold text-slate-700 dark:text-slate-200">
          <input
            type="checkbox"
            data-recon-link-remember={link.card.id}
            checked={pickOf(link).remember}
            onChange={(e) => setPick(link, { remember: e.target.checked })}
            className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-900"
          />
          {t(`${L}remember`)}
        </label>
      </span>
    ) : link.to !== null ? (
      <span className="inline-flex items-center gap-1.5">
        <LinkPlace place={link.to} />
        {link.resolvedBy === 'alias' && (
          <span className="rounded bg-slate-100 px-1 py-px text-[10.5px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            {t(`${L}resolvedAlias`)}
          </span>
        )}
      </span>
    ) : null;

  const sheetSays = (link: FleetFuelReconcileLinkDto): string =>
    link.sheetCode === null
      ? t(`${L}sheetSaysNothing`)
      : t(`${L}sheetSays`, { code: link.sheetCode });

  /** ✓ / ✗ of a unit — or what was decided. */
  const decision = (group: LinkGroup, unit: LinkUnit): JSX.Element => {
    const [head] = unit;
    const decided = linkDecisionOf(head, results);
    const repair = unitInRepair(unit);
    const moved = unit.some((link) => refused.has(idOf(link)));
    const apply = t(
      isSwap(unit) && group.kind === 'move' ? `${L}moveBoth` : `${L}${APPLY_WORD[group.kind]}`,
    );
    const send = (choice: FleetFuelReconcileDecision): void =>
      onDecide(linkBodyOf(unit, choice, picks));
    return (
      <span className="inline-flex flex-col items-center gap-1.5">
        {decided !== null ? (
          <span
            data-recon-link-verdict={decided}
            className={cn(
              'inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1 text-[13px] font-bold',
              decided === 'apply'
                ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
                : 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300',
            )}
          >
            {decided === 'apply' ? `✓ ${apply}` : `✗ ${t(`${L}keep`)}`}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <button
              type="button"
              data-recon-link-apply={head.card.id}
              disabled={!mayDecide || busy || repair || moved || !unitPicked(unit, picks)}
              onClick={() => send('apply')}
              className={cn(DECIDE, APPLY)}
            >
              ✓ {apply}
            </button>
            <button
              type="button"
              data-recon-link-keep={head.card.id}
              disabled={!mayDecide || busy}
              onClick={() => send('reject')}
              className={cn(DECIDE, KEEP)}
            >
              ✗ {t(`${L}keep`)}
            </button>
          </span>
        )}
        {repair && decided === null && (
          <span
            data-recon-link-in-repair={head.card.id}
            className="inline-flex items-center gap-1 rounded border border-amber-400 bg-amber-100 px-1.5 py-px text-[11px] font-bold text-amber-900 dark:border-amber-400/50 dark:bg-amber-400/15 dark:text-amber-200"
          >
            <BoardIcon d={PATH.lock} className="h-3 w-3" />
            {t(`${L}inRepair`)}
          </span>
        )}
        {moved && decided === null && (
          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-amber-400 bg-amber-100 px-1.5 py-px text-[11px] font-bold text-amber-900 dark:border-amber-400/50 dark:bg-amber-400/15 dark:text-amber-200">
            <BoardIcon d={MOVED_ICON} className="h-3 w-3" />
            {t('fleet.fuelCards.reconcile.movedTag')}
          </span>
        )}
      </span>
    );
  };

  const repairNote = (
    <span className="block rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-[12px] font-semibold leading-relaxed text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
      {t(`${L}inRepairNote`)}
    </span>
  );
  const pairTitle = (unit: LinkUnit): JSX.Element => (
    <>
      <BoardIcon
        d={['M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4']}
        className="h-3.5 w-3.5"
      />
      {isSwap(unit)
        ? t(`${L}swap`)
        : t(`${L}exchange`, { a: placeWords(unit[0], 'card'), b: placeWords(unit[0], 'to') })}
    </>
  );
  const groupHead = (group: LinkGroup): JSX.Element => (
    <span className="flex flex-wrap items-center gap-2">
      <span
        className={cn(
          'rounded-full border px-2.5 py-0.5 text-xs font-bold',
          GROUP_TONE[group.kind],
        )}
      >
        {t(`${L}ask.${group.kind}`)}
      </span>
      <span className="text-sm font-bold text-slate-800 dark:text-slate-200">
        {t(`${L}group.${group.kind}`)}
      </span>
      <span className="whitespace-nowrap rounded bg-slate-100 px-1.5 py-px text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        {count.cards(group.cards)}
      </span>
    </span>
  );
  /** «سجل الكارت» of a card whose ✓ went through — as it stands now. */
  const history = (link: FleetFuelReconcileLinkDto): JSX.Element | null => {
    const answer = results[idOf(link)];
    return answer?.decision === 'apply' ? (
      <HistoryButton card={link.card} onOpen={() => onHistory(cardAfterLink(link, answer))} />
    ) : null;
  };
  const inSystem = (link: FleetFuelReconcileLinkDto): JSX.Element =>
    link.card.vehicleCode === null ? (
      <span className="inline-flex flex-col items-center gap-0.5">
        <Place card={link.card} />
        <span className="text-[11px] text-slate-500 dark:text-slate-400">{t(`${L}noCar`)}</span>
      </span>
    ) : (
      <Place card={link.card} />
    );

  /** One card's row: card · in the system · ← · in the sheet · evidence · (the unit's decision). */
  const row = (
    link: FleetFuelReconcileLinkDto,
    unitDecision: ReactNode,
    span: number,
    first: boolean,
  ): JSX.Element => (
    <tr
      key={link.card.id}
      data-recon-link={link.kind}
      data-recon-link-card={link.card.id}
      className={cn('align-middle', first && 'border-t border-slate-100 dark:border-slate-800/80')}
    >
      <td className={cn(TD, 'text-start')}>
        <span className="flex flex-col items-start gap-0.5">
          <span
            dir="ltr"
            className="whitespace-nowrap font-figures text-[15px] font-bold tracking-wide text-slate-900 dark:text-white"
          >
            {link.card.name}
          </span>
          <span
            dir="ltr"
            className={cn(NUM, 'whitespace-nowrap text-[13px] text-slate-500 dark:text-slate-400')}
          >
            {dots(link.card.number)}
          </span>
        </span>
      </td>
      <td className={cn(TD, 'text-center')}>{inSystem(link)}</td>
      <td
        className="px-1 text-center text-lg font-black text-slate-400 dark:text-slate-500"
        aria-hidden
      >
        ←
      </td>
      <td className={cn(TD, 'text-center')}>
        <span className="inline-flex flex-col items-center gap-1">
          <span className="whitespace-nowrap text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            {sheetSays(link)}
          </span>
          {sheetPlace(link)}
        </span>
      </td>
      <td className={cn(TD, 'text-center')}>
        <span className="inline-flex items-center gap-2">
          <Evidence link={link} />
          {history(link)}
        </span>
      </td>
      {first && (
        <td
          rowSpan={span}
          className={cn(TD, 'border-s border-slate-100 text-center dark:border-slate-800/80')}
        >
          {unitDecision}
        </td>
      )}
    </tr>
  );

  return (
    <section className={SECTION_CARD} data-recon-links="true">
      <div className={SECTION_STRIP}>
        <span className="flex flex-wrap items-center gap-3">
          <span className="rounded-lg bg-cyan-500/10 p-1.5 text-cyan-700 dark:text-cyan-300">
            <BoardIcon d={PATH.link} className="h-4 w-4" />
          </span>
          <h2 className={TITLE}>{t(`${L}title`)}</h2>
          <span className={MOVES_CHIP}>{t(`${L}chip`, { cards: count.cards(cards) })}</span>
        </span>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {t(`${L}note`, {
            column:
              codeColumn === undefined
                ? ''
                : `${codeColumn.header ?? ''} (${codeColumn.column})`.trim(),
          })}
        </span>
      </div>
      {/* A phone: each card stacked — from, to, the evidence, the decision under them. */}
      <div className="bg-white md:hidden dark:bg-[#0d1424]/85" data-recon-links-phone="true">
        {groups.map((group) => (
          <div key={group.kind}>
            <div className="border-t border-slate-200 bg-slate-50/70 px-3 py-2 dark:border-[#1c293f] dark:bg-[#0b1220]">
              {groupHead(group)}
            </div>
            {group.units.map((unit) => (
              <div
                key={unit[0].card.id}
                className="space-y-2 border-t border-slate-100 px-3 py-3 dark:border-slate-800/80"
              >
                {unit.length > 1 && (
                  <span className="flex items-center gap-1.5 text-[12px] font-bold text-slate-600 dark:text-slate-300">
                    {pairTitle(unit)}
                  </span>
                )}
                {unit.map((link) => (
                  <div
                    key={link.card.id}
                    data-recon-link-phone={link.card.id}
                    className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-2.5 dark:border-slate-800 dark:bg-[#0b0f19]"
                  >
                    <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span
                        dir="ltr"
                        className="font-figures text-[14px] font-bold tracking-wide text-slate-900 dark:text-white"
                      >
                        {link.card.name}
                      </span>
                      <span
                        dir="ltr"
                        className={cn(NUM, 'text-[12px] text-slate-500 dark:text-slate-400')}
                      >
                        {dots(link.card.number)}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2 text-[12px] text-slate-600 dark:text-slate-300">
                      <span className="inline-flex items-center gap-1.5">
                        {t(`${L}colInSystem`)}
                        <Place card={link.card} />
                      </span>
                      <span
                        aria-hidden
                        className="text-base font-black text-slate-400 dark:text-slate-500"
                      >
                        ←
                      </span>
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        {sheetSays(link)}
                        {sheetPlace(link)}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2 text-[12px] text-slate-600 dark:text-slate-300">
                      {t(`${L}colEvidence`)}
                      <Evidence link={link} />
                      {history(link)}
                    </span>
                  </div>
                ))}
                {unitInRepair(unit) && repairNote}
                <div className="flex justify-end">{decision(group, unit)}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="hidden overflow-x-auto bg-white md:block dark:bg-[#0d1424]/85">
        <table className="w-full border-collapse" data-recon-links-list="true">
          <thead>
            <tr className="bg-slate-50 text-slate-500 dark:bg-[#0c1322] dark:text-slate-400 [&_th]:shadow-[inset_0_-1px_0_#cbd5e1] dark:[&_th]:shadow-[inset_0_-1px_0_#233552]">
              <th className={cn(TH, 'text-start')}>{t('fleet.fuelCards.reconcile.colCard')}</th>
              <th className={cn(TH, 'text-center')}>{t(`${L}colInSystem`)}</th>
              <th className="w-6" />
              <th className={cn(TH, 'text-center')}>{t(`${L}colInSheet`)}</th>
              <th className={cn(TH, 'text-center')}>{t(`${L}colEvidence`)}</th>
              <th className={cn(TH, 'text-center')}>
                {t('fleet.fuelCards.reconcile.colDecision')}
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <Fragment key={group.kind}>
                <tr data-recon-link-group={group.kind}>
                  <td
                    colSpan={6}
                    className="border-t border-slate-200 bg-slate-50/70 px-3 py-2 dark:border-[#1c293f] dark:bg-[#0b1220]"
                  >
                    {groupHead(group)}
                  </td>
                </tr>
                {group.units.map((unit) => {
                  const unitDecision = decision(group, unit);
                  return (
                    <Fragment key={unit[0].card.id}>
                      {unit.length > 1 && (
                        <tr data-recon-link-pair={unit[0].card.id}>
                          <td
                            colSpan={6}
                            className="border-t border-slate-100 px-3 pb-0 pt-2 dark:border-slate-800/80"
                          >
                            <span className="inline-flex items-center gap-1.5 text-[12px] font-bold text-slate-600 dark:text-slate-300">
                              {pairTitle(unit)}
                            </span>
                          </td>
                        </tr>
                      )}
                      {unit.map((link, i) => row(link, unitDecision, unit.length, i === 0))}
                      {unitInRepair(unit) && (
                        <tr>
                          <td colSpan={6} className="px-3 pb-2.5 pt-0">
                            {repairNote}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};
