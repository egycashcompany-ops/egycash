// «كروت في الشيت وليست في النظام» (6b) — the sheet rows that name a card no card of the company has,
// in place of the passive fold. Each row: its name (as rebuilt), the number as the sheet shows it,
// the sheet's balance, the car the sheet's code names (and whether it already has a card of this
// company), the chassis in the name as evidence, and «إضافة», which opens «إضافة كارت» filled from
// the row — he types the full number (a statement masks it), the expiry and the PIN; the opening
// balance is the sheet's. Nothing is added on its own. A row the server would refuse — its name
// carries the other company's prefix, or is longer than a card name may be — is not offered
// «إضافة»: it says why instead.
import { type FleetFuelCardCompany, type FleetFuelReconcileNewCardDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { cn } from '../../../../shared/lib/cn';
import { BoardIcon, NUM, PATH } from '../FuelCardBoard';
import { MOVES_CHIP, SECTION_CARD, SECTION_STRIP } from '../custody-board-looks';
import { TITLE } from '../custody-dashboard-parts';
import { CodeChip } from '../custody-memo-parts';
import { maskedOf } from '../../lib/fuel-reconcile';
import { CARD_NAME_MAX, addCardBlockOf, chassisOfName } from '../../lib/fuel-reconcile-links';
import { useReconcileCount } from '../../lib/fuel-reconcile-words';
import { Figure } from './reconcile-cells';

const N = 'fleet.fuelCards.reconcile.newCards.';
const TH = 'whitespace-nowrap px-3 py-2.5 text-[13px] font-semibold';
const TD = 'px-3 py-2 text-sm text-slate-700 dark:text-slate-200';

export const ReconcileNewCards = ({
  rows,
  company,
  added,
  mayAdd,
  onAdd,
}: {
  rows: readonly FleetFuelReconcileNewCardDto[];
  company: FleetFuelCardCompany;
  /** Rows added on this screen, by sheet row → the new card's id. */
  added: Readonly<Record<number, string>>;
  /**
   * `fleetFuelCard.create` AND `fleetFuelCharge.approve` (the card opens at the sheet's balance) —
   * without both «إضافة» is not offered; the server asks both too.
   */
  mayAdd: boolean;
  onAdd: (row: FleetFuelReconcileNewCardDto) => void;
}): JSX.Element | null => {
  const t = useT();
  const count = useReconcileCount();
  if (rows.length === 0) return null;
  const companyName = t(`fleet.fuelCards.company.${company}`);
  return (
    <section className={SECTION_CARD} data-recon-new-cards="true">
      <div className={SECTION_STRIP}>
        <span className="flex flex-wrap items-center gap-3">
          <span className="rounded-lg bg-blue-500/10 p-1.5 text-blue-700 dark:text-blue-300">
            <BoardIcon d={PATH.plus} className="h-4 w-4" />
          </span>
          <h2 className={TITLE}>{t(`${N}title`)}</h2>
          <span className={MOVES_CHIP}>{count.cards(rows.length)}</span>
        </span>
        <span className="text-xs text-slate-500 dark:text-slate-400">{t(`${N}note`)}</span>
      </div>
      <div className="overflow-x-auto bg-white dark:bg-[#0d1424]/85">
        <table className="w-full border-collapse" data-recon-new-list="true">
          <thead>
            <tr className="bg-slate-50 text-slate-500 dark:bg-[#0c1322] dark:text-slate-400 [&_th]:shadow-[inset_0_-1px_0_#cbd5e1] dark:[&_th]:shadow-[inset_0_-1px_0_#233552]">
              <th className={cn(TH, 'w-16 text-center')}>
                {t('fleet.fuelCards.reconcile.colRow')}
              </th>
              <th className={cn(TH, 'text-start')}>{t('fleet.fuelCards.reconcile.colName')}</th>
              <th className={cn(TH, 'text-center')}>
                {t('fleet.fuelCards.reconcile.colSheetNumber')}
              </th>
              <th className={cn(TH, 'text-center')}>{t('fleet.fuelCards.reconcile.colSheet')}</th>
              <th className={cn(TH, 'text-center')}>{t(`${N}colCarInSheet`)}</th>
              <th className={cn(TH, 'text-center')}>
                {t('fleet.fuelCards.reconcile.links.colEvidence')}
              </th>
              <th className={cn(TH, 'text-center')} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const done = row.cardId !== null || added[row.sheetRow] !== undefined;
              const blocked = addCardBlockOf(row, company);
              return (
                <tr
                  key={row.sheetRow}
                  data-recon-new-row={row.sheetRow}
                  className="border-t border-slate-100 align-middle dark:border-slate-800/80"
                >
                  <td className={cn(TD, 'text-center')}>
                    <span
                      dir="ltr"
                      className={cn(NUM, 'text-xs text-slate-500 dark:text-slate-400')}
                    >
                      {row.sheetRow}
                    </span>
                  </td>
                  <td className={cn(TD, 'text-start')}>
                    <span
                      dir="ltr"
                      className="whitespace-nowrap font-figures text-[15px] font-bold tracking-wide text-slate-900 dark:text-white"
                    >
                      {row.name}
                    </span>
                  </td>
                  <td className={cn(TD, 'text-center')}>
                    <span dir="ltr" className={cn(NUM, 'whitespace-nowrap font-bold')}>
                      {maskedOf(row.number)}
                    </span>
                  </td>
                  <td className={cn(TD, 'text-center')}>
                    <Figure value={row.balance} />
                  </td>
                  <td className={cn(TD, 'text-center')}>
                    <span className="inline-flex flex-col items-center gap-1">
                      {row.to?.vehicleCode != null ? (
                        <>
                          <CodeChip code={row.to.vehicleCode} />
                          {row.slotHeldBy === null ? (
                            <span className="whitespace-nowrap text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                              {t(`${N}slotFree`, { company: companyName })}
                            </span>
                          ) : (
                            <span
                              data-recon-new-slot-held={row.sheetRow}
                              className="whitespace-nowrap text-[11px] font-semibold text-amber-700 dark:text-amber-300"
                            >
                              {t(`${N}slotHeld`, {
                                company: companyName,
                                name: row.slotHeldBy.name,
                              })}
                            </span>
                          )}
                        </>
                      ) : row.to?.label != null ? (
                        <span className="inline-flex items-center whitespace-nowrap rounded border border-violet-300 bg-violet-50 px-1.5 py-0.5 text-[13px] font-bold text-violet-800 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300">
                          {row.to.label}
                        </span>
                      ) : (
                        <>
                          <span className="whitespace-nowrap text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                            {row.sheetCode === null
                              ? t('fleet.fuelCards.reconcile.links.sheetSaysNothing')
                              : t('fleet.fuelCards.reconcile.links.sheetSays', {
                                  code: row.sheetCode,
                                })}
                          </span>
                          {row.sheetCode !== null && (
                            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[12px] font-bold text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
                              <BoardIcon d={PATH.warn} className="h-3 w-3" />
                              {t(`${N}codeUnknown`, { code: row.sheetCode })}
                            </span>
                          )}
                        </>
                      )}
                    </span>
                  </td>
                  <td className={cn(TD, 'text-center')}>
                    <span className="inline-flex flex-col items-center gap-0.5">
                      <span
                        dir="ltr"
                        className={cn(NUM, 'text-[12px] text-slate-500 dark:text-slate-400')}
                      >
                        {chassisOfName(row.name)}
                      </span>
                      {row.chassisCar === null ? (
                        <span className="whitespace-nowrap text-[12px] font-semibold text-slate-500 dark:text-slate-400">
                          {t('fleet.fuelCards.reconcile.links.chassisNone')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[12px] font-bold text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                          ✓{' '}
                          {t('fleet.fuelCards.reconcile.links.chassisCar', {
                            code: row.chassisCar,
                          })}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className={cn(TD, 'text-center')}>
                    {done ? (
                      <span
                        data-recon-added={row.sheetRow}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[13px] font-bold text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
                      >
                        ✓ {t(`${N}added`)}
                      </span>
                    ) : blocked !== null ? (
                      <span
                        data-recon-add-blocked={row.sheetRow}
                        className="inline-flex max-w-[16rem] items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[12px] font-bold text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
                      >
                        <BoardIcon d={PATH.warn} className="h-3 w-3 shrink-0" />
                        {blocked === 'nameOtherCompany'
                          ? t(`${N}blockedOtherCompany`)
                          : t(`${N}blockedTooLong`, { max: CARD_NAME_MAX })}
                      </span>
                    ) : (
                      mayAdd && (
                        <button
                          type="button"
                          data-recon-add={row.sheetRow}
                          onClick={() => onAdd(row)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#4f3dff] to-[#6a5cff] px-3.5 py-1.5 text-sm font-bold text-white shadow-[0_4px_16px_rgba(91,76,255,0.4)] transition hover:from-[#5a4aff] hover:to-[#7a6dff]"
                        >
                          <BoardIcon d={PATH.plus} className="h-3.5 w-3.5" />
                          {t(`${N}add`)}
                        </button>
                      )
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
};
