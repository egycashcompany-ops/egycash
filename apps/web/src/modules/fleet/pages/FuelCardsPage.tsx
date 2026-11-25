// بطاقات الوقود (الفيز) — every car with its two card slots, Wataniya and Chill Out, then the cards
// on no car (the stock). Drawn to the owner's own design code (`FuelCardBoard`).
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  FleetSettingKeys,
  cairoYmd,
  periodOf,
  type FleetFuelCardCompany,
  type FleetFuelCardDto,
  type Locale,
  sameVehicleCode,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer } from '../../../platform/layout/PageContainer';
import { useMySettings } from '../../../platform/settings/settings-api';
import { Button } from '../../../shared/ui/Button';
import { Dialog } from '../../../shared/ui/Dialog';
import { Input } from '../../../shared/ui/form';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { toast } from '../../../shared/ui/toast/toast-store';
import { cn } from '../../../shared/lib/cn';
import { formatMoneyParts } from '../../../shared/lib/format';
import { latinDate } from '../lib/fleet-figures';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { readList, writeList } from '../../../shared/lib/list-param';
import { getActiveBranch } from '../../../shared/lib/api-client';
import { BranchFilterSelect } from '../../hr/recruitment/shared/BranchFilterSelect';
import {
  useAllFuelCards,
  useAllVehicles,
  useDeleteFuelCard,
  useReceiptSummary,
  useUpdateFuelCard,
} from '../api/fleet-queries';
import { VehicleCodeFilter } from '../components/VehicleCodeFilter';
import { DARK_FILTER_BAR, pickOne } from '../components/dark-filter-bar';
import { FILTER_ICON, FilterWithIcon } from '../components/FilterWithIcon';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { FuelCardDialog } from '../components/FuelCardDialog';
import { FuelCardImageDialog } from '../components/FuelCardImage';
import { FUEL_CARD_COMPANIES } from '../components/FuelCardTiles';
import {
  BOARD_FONT,
  BoardIcon,
  BoardKpi,
  CompanyBadge,
  EmptySlotRow,
  FuelCardRow,
  NoCardsBody,
  PATH,
  StockSection,
  expiryState,
} from '../components/FuelCardBoard';
import { FuelCarGroup } from '../components/FuelCarGroup';
import { groupCardNumber } from '../lib/fuel-card-number';
import { saveSheet } from '../lib/fleet-sheet';
import { printFleetReport } from '../lib/fleet-report-print';
import { useReportSignatories } from '../lib/use-report-signatories';
import { expiryWindowQuery } from '../lib/vehicle-set-params';
import { registryBranchesOf } from '../lib/reader-branches';

const REMEMBERED_FILTERS = [
  'vehicleCodes',
  'company',
  'number',
  'expiresBefore',
  'expiresFrom',
  'branch',
] as const;
const csv = (raw: string | null): string[] => (raw ?? '').split(',').filter((v) => v !== '');

export const FuelCardsPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  const signatories = useReportSignatories();

  const vehicleCodes = csv(sp.get('vehicleCodes'));
  const company = sp.get('company') ?? '';
  const number = sp.get('number') ?? '';
  const expiresBefore = sp.get('expiresBefore') ?? '';
  // The other side of the window: the dashboard's «expiring» figure starts TOMORROW, so the cards
  // already expired (its own red line) are not counted twice.
  const expiresFrom = sp.get('expiresFrom') ?? '';
  // «الفرع» a dashboard figure was counted over: the branch of each card's CURRENT car (a car
  // deleted since by its last branch). The server narrows; a card on no car is in no branch, so the
  // stock below is empty under it.
  const branchIds = readList(sp, 'branch');
  const paramsKey = sp.toString();
  const patch = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(sp);
    for (const [key, val] of Object.entries(updates)) {
      if (val === null || val === '') next.delete(key);
      else next.set(key, val);
    }
    setSp(next);
  };
  // A filter on the CARD (its company, its number, its expiry) leaves a car's other card out of the
  // answer — that slot is filtered away, not empty, and must not read «لا يوجد كارت».
  const cardFiltered =
    company !== '' || number !== '' || expiresBefore !== '' || expiresFrom !== '';
  const filters = useMemo(() => {
    // Both bounds are DAYS, asked as the first instant of `expiresFrom` and the LAST instant of
    // `expiresBefore` (R-02): a card is expired on its expiry day, so «تنتهي قبل» a day includes
    // the cards that run out on it, whatever time they were stamped at.
    const bounds = expiryWindowQuery(expiresFrom, expiresBefore);
    return {
      vehicleCodes: vehicleCodes.length > 0 ? vehicleCodes : undefined,
      company: company || undefined,
      number: number || undefined,
      expiresFrom: bounds.from,
      expiresBefore: bounds.before,
      branchIds: branchIds.length > 0 ? branchIds : undefined,
    };
  }, [paramsKey]);
  const { data, isLoading, isError, error, refetch } = useAllFuelCards(filters);
  const cards = data?.items ?? [];
  const noCarCards = useMemo(() => cards.filter((card) => card.vehicleId === null), [cards]);
  // Every active car of the registry has its block — one with no card says so and offers the
  // stock. A filter on the card shows only the cars whose cards answer it; a filter on the car,
  // the cars chosen, with or without cards; a branch, the cars of that branch only.
  const vehicles = useAllVehicles({ anyStatus: true });
  const carGroups = useMemo(() => {
    const byCar = new Map<
      string,
      {
        vehicleId: string;
        code: string;
        cards: Partial<Record<FleetFuelCardCompany, FleetFuelCardDto>>;
      }
    >();
    for (const card of cards) {
      if (card.vehicleId === null) continue;
      const entry = byCar.get(card.vehicleId) ?? {
        vehicleId: card.vehicleId,
        code: card.vehicleCode ?? '—',
        cards: {},
      };
      entry.cards[card.company] = card;
      byCar.set(card.vehicleId, entry);
    }
    if (!cardFiltered) {
      for (const vehicle of vehicles.data?.items ?? []) {
        if (byCar.has(vehicle.id)) continue;
        const inBranch =
          branchIds.length === 0 ||
          (vehicle.branchId !== null && branchIds.includes(vehicle.branchId));
        const chosen =
          inBranch &&
          (vehicleCodes.length === 0
            ? vehicle.status === 'active'
            : // Whitespace and Latin case aside: «فورتشنر 2» is the stored «فورتشنر 2 ».
              vehicleCodes.some((code) => sameVehicleCode(code, vehicle.code)));
        if (chosen) byCar.set(vehicle.id, { vehicleId: vehicle.id, code: vehicle.code, cards: {} });
      }
    }
    // The numbered cars first, in order; a code that is no number («.», «..») after them all, so
    // it never stands between the reader and the cards.
    const numbered = (code: string): number => (/^\d/u.test(code) ? 0 : 1);
    return [...byCar.values()].sort(
      (a, b) =>
        numbered(a.code) - numbered(b.code) ||
        a.code.localeCompare(b.code, 'en', { numeric: true }),
    );
  }, [cards, vehicles.data, cardFiltered, vehicleCodes.join(','), branchIds.join(',')]);

  // «المعاد اللى عاوز احطه قبل انتهاء الفيزا عشان الانذار» — from Fleet settings.
  const settings = useMySettings();
  const warnDays = Number(
    settings.data?.find((s) => s.key === FleetSettingKeys.FuelCardExpiryWarnDays)?.value ?? 30,
  );

  // The figures across the top.
  const carsWithout = carGroups.filter((group) => Object.keys(group.cards).length === 0).length;
  const states = cards.map((card) => expiryState(card.expiresAt, warnDays));
  const activeCount = states.filter((state) => state !== 'expired').length;
  const soonCount = states.filter((state) => state === 'soon').length;
  const expiredCount = states.filter((state) => state === 'expired').length;
  const carsWithCards = carGroups.length - carsWithout;
  const cardsOnCars = cards.length - noCarCards.length;
  const cardRate =
    carsWithCards === 0 ? '0' : String(Math.round((cardsOnCars / carsWithCards) * 10) / 10);
  // «استهلاك الوقود الحالي (الشهر)»: the fuel receipts of THIS Cairo month up to Cairo today, for
  // a reader who may see receipts; anyone else sees the cards' balances in its place. It asks what
  // the dashboard's «الوقود كله» asks for «هذا الشهر» (R2 `opex.fuel`, the receipts screen's
  // `kind=fuel` total): the 1st of the Cairo month to Cairo today — never a later paper day, never
  // the browser's month — and, when the screen is narrowed, the same branch (the receipt's car's)
  // and the same cars.
  //
  // With no «الفرع» in the address the tile still answers for the branches the tiles beside it do:
  // the cards and the cars are scoped by the server under the command bar's branch (X-Active-Branch)
  // and the reader's grant, while the receipts' summary takes no scope of its own — so the same
  // fold is sent as `branchIds` (the switcher's branch, the reader's reach, or nothing for the whole
  // company), never the company's month beside one branch's cards.
  const month = periodOf('thisMonth', cairoYmd(new Date()));
  const mayReceipts = can('fleetReceipt.view');
  const me = useAppSelector((state) => state.auth.me);
  const receiptBranches =
    branchIds.length > 0
      ? branchIds
      : registryBranchesOf({
          scope: me?.permissions['fleetFuelCard.view'],
          active: getActiveBranch(),
          home: me?.branchId ?? null,
          reach: me?.branchIds ?? [],
        });
  // A reach of no branch has no month to answer (an empty `branchIds` would be no filter at all).
  const noReach = receiptBranches !== null && receiptBranches.length === 0;
  const receipts = useReceiptSummary(
    {
      kind: 'fuel',
      from: month.from,
      to: month.to,
      ...(receiptBranches === null || noReach ? {} : { branchIds: [...receiptBranches] }),
      ...(vehicleCodes.length > 0 ? { vehicleCodes } : {}),
    },
    mayReceipts && !noReach,
  );
  const consumption = mayReceipts && receipts.data !== undefined ? receipts.data : null;

  // «تصفية بالتاريخ»: a ready window from today, or a date of the reader's own.
  const dayFromToday = (days: number): string =>
    new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  const [customDate, setCustomDate] = useState(false);
  // A lower bound is a window neither ready answer names, so it always opens the two date boxes.
  const datePreset =
    expiresFrom !== ''
      ? 'custom'
      : expiresBefore === ''
        ? customDate
          ? 'custom'
          : ''
        : expiresBefore === dayFromToday(30) && !customDate
          ? '30'
          : expiresBefore === dayFromToday(60) && !customDate
            ? '60'
            : 'custom';
  const pickDatePreset = (value: string): void => {
    setCustomDate(value === 'custom');
    if (value === '30' || value === '60')
      patch({ expiresBefore: dayFromToday(Number(value)), expiresFrom: null });
    else if (value === '') patch({ expiresBefore: null, expiresFrom: null });
  };

  // «ربط من كروت العهدة»: a card of the stock put on a car's free slot.
  const [linking, setLinking] = useState<{
    vehicleId: string;
    code: string;
    companies: FleetFuelCardCompany[];
  } | null>(null);
  const update = useUpdateFuelCard();
  const linkPending = update.isPending;
  const linkCard = async (card: FleetFuelCardDto): Promise<void> => {
    if (linking === null) return;
    await update.mutateAsync({
      id: card.id,
      body: { vehicleId: linking.vehicleId, label: null, version: card.version },
    });
    toast.success(t('fleet.fuelCards.board.linked', { code: linking.code }));
    setLinking(null);
  };

  const [adding, setAdding] = useState<{
    vehicleId: string;
    company?: FleetFuelCardCompany | undefined;
  } | null>(null);
  const [editing, setEditing] = useState<FleetFuelCardDto | null>(null);
  // The card whose photo is open, read from the list each render so a replaced photo shows at once.
  const [viewingId, setViewingId] = useState<string | null>(null);
  const viewing = viewingId === null ? null : (cards.find((c) => c.id === viewingId) ?? null);
  const viewingCode = viewing === null ? '' : (viewing.vehicleCode ?? viewing.label ?? '—');
  const [deleting, setDeleting] = useState<FleetFuelCardDto | null>(null);
  const remove = useDeleteFuelCard();
  const confirmDelete = async (): Promise<void> => {
    if (deleting === null) return;
    await remove.mutateAsync(deleting.id);
    toast.success(t('fleet.fuelCards.deleted'));
    setDeleting(null);
  };

  const header = [
    t('fleet.odometer.columns.vehicle'),
    t('fleet.fuelCards.fields.company'),
    t('fleet.fuelCards.fields.name'),
    t('fleet.fuelCards.fields.number'),
    t('fleet.fuelCards.fields.expiresAt'),
    t('fleet.fuelCards.fields.balance'),
  ];
  const sheetRows = () =>
    cards.map((card) => [
      card.vehicleCode ?? card.label ?? '',
      t(`fleet.fuelCards.company.${card.company}`),
      card.name,
      card.number,
      latinDate(card.expiresAt, locale),
      card.balance,
    ]);
  const exportSheet = async (): Promise<void> => {
    saveSheet({
      name: t('fleet.nav.fuelCards'),
      serialHeader: t('fleet.violations.report.serial'),
      header,
      rows: sheetRows(),
      moneyColumns: [5],
    });
  };
  const onPrint = (): void => {
    try {
      printFleetReport({
        title: t('fleet.nav.fuelCards'),
        department: t('fleet.violations.report.department'),
        subtitle: '',
        header,
        rows: sheetRows().map((row) => row.map(String)),
        totals: [],
        signatories,
        serialHeader: t('fleet.violations.report.serial'),
        emptyLabel: t('fleet.violations.report.empty'),
      });
    } catch {
      toast.error(t('fleet.violations.popupBlocked'));
    }
  };

  // The free slots a car may fill from the stock — its companies with no card on it yet.
  const linkChoices =
    linking === null ? [] : noCarCards.filter((card) => linking.companies.includes(card.company));

  return (
    <PageContainer>
      <div className={cn(BOARD_FONT, 'space-y-6 text-slate-900 dark:text-slate-100 antialiased')}>
        {/* «شيل العنوان»: the screen opens on its figures. */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <BoardKpi
            testId="cars"
            tone="blue"
            icon={PATH.truck}
            label={t('fleet.fuelCards.board.kpi.cars')}
            value={String(carGroups.length)}
            unit={t('fleet.fuelCards.board.kpi.carsUnit')}
            note={
              carsWithout === 0 ? (
                <span className="text-emerald-600 dark:text-emerald-400">
                  ✓ {t('fleet.fuelCards.board.kpi.carsAllLinked')}
                </span>
              ) : (
                <span className="text-amber-600 dark:text-amber-400">
                  ⚠️ {t('fleet.fuelCards.board.kpi.carsMissing', { count: String(carsWithout) })}
                </span>
              )
            }
          />
          <BoardKpi
            testId="active"
            tone="emerald"
            icon={PATH.card}
            label={t('fleet.fuelCards.board.kpi.active')}
            value={String(activeCount)}
            valueClass="text-emerald-600 dark:text-emerald-400"
            unit={t('fleet.fuelCards.board.kpi.activeUnit')}
            note={
              <span className="text-slate-500 dark:text-slate-400">
                <span className="text-slate-600 dark:text-slate-300">
                  {t('fleet.fuelCards.board.kpi.activeRateLead', { rate: cardRate })}
                </span>{' '}
                {t('fleet.fuelCards.board.kpi.activeRateTail')}
              </span>
            }
          />
          <BoardKpi
            testId="soon"
            tone="amber"
            icon={PATH.warn}
            hoverBorder="hover:border-amber-500/40"
            label={t('fleet.fuelCards.board.kpi.soon', { days: String(warnDays) })}
            value={String(soonCount)}
            valueClass="text-amber-600 dark:text-amber-400"
            unit={t('fleet.fuelCards.board.kpi.soonUnit')}
            note={
              expiredCount > 0 ? (
                <span className="text-red-600 dark:text-red-400">
                  ⚠️ {t('fleet.fuelCards.board.kpi.expiredAdvice', { count: String(expiredCount) })}
                </span>
              ) : soonCount > 0 ? (
                <span className="text-amber-600 dark:text-amber-400">
                  ⚠️ {t('fleet.fuelCards.board.kpi.soonAdvice')}
                </span>
              ) : (
                <span className="text-emerald-600 dark:text-emerald-400">
                  ✓ {t('fleet.fuelCards.board.kpi.soonNone')}
                </span>
              )
            }
          />
          {consumption !== null ? (
            <BoardKpi
              testId="consumption"
              tone="cyan"
              icon={PATH.trend}
              label={t('fleet.fuelCards.board.kpi.consumption')}
              value={latinMoney(consumption.fuelTotal, locale)}
              unit={t('fleet.fuelCards.board.kpi.currency')}
              unitClass="font-bold text-cyan-600 dark:text-cyan-400"
              note={
                <span className="text-slate-500 dark:text-slate-400">
                  {t('fleet.fuelCards.board.kpi.consumptionNote', {
                    count: String(consumption.count),
                  })}
                </span>
              }
            />
          ) : (
            <BoardKpi
              testId="balance"
              tone="cyan"
              icon={PATH.trend}
              label={t('fleet.fuelCards.board.kpi.balance')}
              value={latinMoney(balanceOf(cards), locale)}
              unit={t('fleet.fuelCards.board.kpi.currency')}
              unitClass="font-bold text-cyan-600 dark:text-cyan-400"
              note={
                <span className="text-slate-500 dark:text-slate-400">
                  {t('fleet.fuelCards.board.kpi.balanceNote', {
                    wataniya: latinMoney(balanceOf(cards, 'wataniya'), locale),
                    chillout: latinMoney(balanceOf(cards, 'chillout'), locale),
                  })}
                </span>
              }
            />
          )}
        </section>

        {/* The exports and «إضافة كارت جديد» above the filters, as on the vehicles screen. */}
        <div className="flex flex-wrap items-center justify-end gap-2" data-fuel-toolbar="true">
          {!isError && (
            <div className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/80 p-0.5">
              <button
                type="button"
                data-export="fuel-cards"
                title={t('fleet.fuelCards.board.excel')}
                onClick={() => void exportSheet()}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200 transition hover:bg-emerald-50 dark:hover:bg-emerald-950/60 hover:text-emerald-700 dark:hover:text-emerald-300"
              >
                <BoardIcon
                  d={PATH.excel}
                  className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
                />
                <span>{t('fleet.fuelCards.board.excel')}</span>
              </button>
              <span className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
              <button
                type="button"
                data-print="fuel-cards"
                title={t('fleet.fuelCards.board.pdf')}
                onClick={onPrint}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200 transition hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-600 dark:hover:text-red-400"
              >
                <BoardIcon d={PATH.pdf} className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
                <span>{t('fleet.fuelCards.board.pdf')}</span>
              </button>
            </div>
          )}
          {can('fleetFuelCard.create') && (
            <button
              type="button"
              data-fuel-add-new="true"
              onClick={() => setAdding({ vehicleId: '' })}
              className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-gradient-to-r from-brand-700 to-brand-500 px-3.5 py-2 text-xs font-black text-white shadow-md shadow-brand-700/30 transition hover:from-brand-600 hover:to-brand-400"
            >
              <BoardIcon d={PATH.plus} className="h-3.5 w-3.5" width={2.5} />
              <span>{t('fleet.fuelCards.board.add')}</span>
            </button>
          )}
        </div>
        {/* «الفلاتر … تكون زى شاشه السيارات»: the same dark bar, one row on a computer. */}
        <div className={DARK_FILTER_BAR}>
          <FilterBar
            hasActiveFilters={vehicleCodes.length > 0 || cardFiltered || branchIds.length > 0}
            onClear={() => {
              setCustomDate(false);
              patch({
                vehicleCodes: null,
                company: null,
                number: null,
                expiresBefore: null,
                expiresFrom: null,
                branch: null,
              });
            }}
          >
            <FilterWithIcon
              icon={FILTER_ICON.car}
              tone="text-emerald-600 dark:text-emerald-400"
              className="w-32 shrink-0"
            >
              <VehicleCodeFilter
                fullWidth
                density="tight"
                placeholder={t('fleet.fuelCards.board.searchCar')}
                value={vehicleCodes}
                onChange={(next) =>
                  patch({ vehicleCodes: next.length === 0 ? null : next.join(',') })
                }
              />
            </FilterWithIcon>
            <FilterWithIcon
              icon={FILTER_ICON.card}
              tone="text-amber-600 dark:text-amber-400"
              className="w-40 shrink-0"
            >
              <Input
                data-fuel-number-filter="true"
                aria-label={t('fleet.fuelCards.filters.number')}
                placeholder={t('fleet.fuelCards.filters.number')}
                value={number}
                rule="digits"
                density="tight"
                onChange={(e) => patch({ number: e.target.value.replace(/\s+/gu, '') || null })}
              />
            </FilterWithIcon>
            <FilterWithIcon
              icon={FILTER_ICON.company}
              tone="text-slate-600 dark:text-slate-300"
              className="w-36 shrink-0"
            >
              <MultiSelect
                clearable
                className="w-full"
                fullWidth
                density="tight"
                showSelectedValues
                searchThreshold={0}
                label={t('fleet.fuelCards.fields.company')}
                options={FUEL_CARD_COMPANIES.map((option) => ({
                  value: option,
                  label: t(`fleet.fuelCards.company.${option}`),
                }))}
                value={company === '' ? [] : [company]}
                onChange={(next) =>
                  patch({ company: pickOne(company === '' ? [] : [company], next) })
                }
              />
            </FilterWithIcon>
            <FilterWithIcon
              icon={FILTER_ICON.calendar}
              tone="text-cyan-600 dark:text-cyan-400"
              className="w-40 shrink-0"
            >
              <MultiSelect
                clearable
                className="w-full"
                fullWidth
                density="tight"
                showSelectedValues
                searchThreshold={0}
                label={t('fleet.fuelCards.filters.expiresBefore')}
                options={(['30', '60', 'custom'] as const).map((value) => ({
                  value,
                  label: t(
                    value === '30'
                      ? 'fleet.fuelCards.board.date30'
                      : value === '60'
                        ? 'fleet.fuelCards.board.date60'
                        : 'fleet.fuelCards.board.dateCustom',
                  ),
                }))}
                value={datePreset === '' ? [] : [datePreset]}
                onChange={(next) =>
                  pickDatePreset(pickOne(datePreset === '' ? [] : [datePreset], next) ?? '')
                }
              />
            </FilterWithIcon>
            {datePreset === 'custom' && (
              <FilterWithIcon
                icon={FILTER_ICON.calendar}
                tone="text-cyan-600 dark:text-cyan-400"
                className="w-36 shrink-0"
                datePicker={{ label: t('fleet.fuelCards.filters.expiresFrom') }}
              >
                <Input
                  type="date"
                  data-fuel-expires-from="true"
                  aria-label={t('fleet.fuelCards.filters.expiresFrom')}
                  value={expiresFrom}
                  density="tight"
                  onChange={(e) => patch({ expiresFrom: e.target.value || null })}
                  className="[color-scheme:dark]"
                />
              </FilterWithIcon>
            )}
            {datePreset === 'custom' && (
              <FilterWithIcon
                icon={FILTER_ICON.calendar}
                tone="text-cyan-600 dark:text-cyan-400"
                className="w-36 shrink-0"
                datePicker={{ label: t('fleet.fuelCards.filters.expiresBefore') }}
              >
                <Input
                  type="date"
                  aria-label={t('fleet.fuelCards.filters.expiresBefore')}
                  value={expiresBefore}
                  density="tight"
                  onChange={(e) => patch({ expiresBefore: e.target.value || null })}
                  className="[color-scheme:dark]"
                />
              </FilterWithIcon>
            )}
            {/* «الفرع» a dashboard link narrowed the cards to — shown only while it does, so a
                remembered one is never a filter with nothing on the bar saying so; it comes off
                here or with «مسح». `BranchFilterSelect` takes no width of its own. */}
            {branchIds.length > 0 && (
              <div data-fuel-branch-filter={branchIds.join(',')} className="contents">
                <FilterWithIcon
                  icon={FILTER_ICON.branch}
                  tone="text-violet-600 dark:text-violet-300"
                  className="[&>div>div:not([role=listbox])]:flex [&>div>div:not([role=listbox])]:w-full [&_button[aria-haspopup]]:w-full [&_button[aria-haspopup]]:justify-between"
                >
                  <BranchFilterSelect
                    clearable
                    value={branchIds}
                    onChange={(ids) => patch({ branch: writeList(ids) })}
                  />
                </FilterWithIcon>
              </div>
            )}
          </FilterBar>
        </div>

        {isError ? (
          <EmptyState
            title={t('common.error')}
            description={String(error)}
            action={<Button onClick={() => void refetch()}>{t('common.retry')}</Button>}
          />
        ) : !isLoading && carGroups.length === 0 && noCarCards.length === 0 ? (
          <EmptyState title={t('fleet.fuelCards.empty')} />
        ) : (
          <div className="space-y-3">
            {carGroups.map((group) => {
              const held = FUEL_CARD_COMPANIES.filter((slot) => group.cards[slot] !== undefined);
              const free = FUEL_CARD_COMPANIES.filter((slot) => group.cards[slot] === undefined);
              // A filter on the card leaves a car's other card out of the answer — that slot is
              // filtered away, not free, and is not offered.
              const slots = FUEL_CARD_COMPANIES.filter(
                (slot) => group.cards[slot] !== undefined || !cardFiltered,
              );
              const mayAdd = can('fleetFuelCard.create');
              const mayLink = can('fleetFuelCard.edit');
              return (
                <FuelCarGroup
                  key={group.vehicleId}
                  vehicleId={group.vehicleId}
                  code={group.code}
                  held={held.length}
                >
                  {held.length === 0 ? (
                    <NoCardsBody
                      {...(mayLink
                        ? {
                            onLink: () =>
                              setLinking({
                                vehicleId: group.vehicleId,
                                code: group.code,
                                companies: free,
                              }),
                          }
                        : {})}
                      {...(mayAdd
                        ? { onAdd: () => setAdding({ vehicleId: group.vehicleId }) }
                        : {})}
                    />
                  ) : (
                    slots.map((slot) => {
                      const card = group.cards[slot];
                      if (card === undefined) {
                        return (
                          <EmptySlotRow
                            key={slot}
                            company={slot}
                            {...(mayLink || mayAdd
                              ? {
                                  onLink: () =>
                                    setLinking({
                                      vehicleId: group.vehicleId,
                                      code: group.code,
                                      companies: [slot],
                                    }),
                                }
                              : {})}
                          />
                        );
                      }
                      return (
                        <FuelCardRow
                          key={slot}
                          card={card}
                          warnDays={warnDays}
                          onEdit={setEditing}
                          onDelete={setDeleting}
                          onPhoto={(c) => setViewingId(c.id)}
                        />
                      );
                    })
                  )}
                </FuelCarGroup>
              );
            })}
            {noCarCards.length > 0 && (
              <StockSection
                cards={noCarCards}
                {...(can('fleetFuelCard.create')
                  ? { onAdd: () => setAdding({ vehicleId: '' }) }
                  : {})}
                onAssign={setEditing}
                onPhoto={(c) => setViewingId(c.id)}
                onDelete={setDeleting}
              />
            )}
          </div>
        )}
      </div>

      <LinkFromStockDialog
        open={linking !== null}
        onClose={() => setLinking(null)}
        code={linking?.code ?? ''}
        cards={linkChoices}
        pending={linkPending}
        onPick={(card) => void linkCard(card)}
        {...(can('fleetFuelCard.create') && linking !== null
          ? {
              onAddNew: () => {
                const target = linking;
                setLinking(null);
                setAdding({
                  vehicleId: target.vehicleId,
                  ...(target.companies.length === 1 ? { company: target.companies[0] } : {}),
                });
              },
            }
          : {})}
      />
      <FuelCardDialog
        open={adding !== null || editing !== null}
        onClose={() => {
          setAdding(null);
          setEditing(null);
        }}
        card={editing}
        photoCard={editing === null ? null : (cards.find((c) => c.id === editing.id) ?? editing)}
        onOpenPhoto={(c) => setViewingId(c.id)}
        initialVehicleId={adding?.vehicleId ?? ''}
        {...(adding?.company === undefined ? {} : { initialCompany: adding.company })}
      />
      {/* After the form, so the photo opened from it sits above it. */}
      <FuelCardImageDialog
        open={viewing !== null}
        onClose={() => setViewingId(null)}
        card={viewing}
        code={viewingCode}
      />
      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t('fleet.fuelCards.deleteTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => void confirmDelete()}
            >
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t('fleet.fuelCards.deleteBody')}
        </p>
      </Dialog>
    </PageContainer>
  );
};

/**
 * «245,890.50» — money in Latin digits with thousands commas and its piastres, as this screen's own
 * rows and the dashboard write it (`formatMoneyParts`, two decimals); the unit stands beside it.
 */
const latinMoney = (value: number, locale: Locale): string =>
  formatMoneyParts(value, 'EGP', locale).figure;

const balanceOf = (cards: readonly FleetFuelCardDto[], company?: FleetFuelCardCompany): number =>
  cards
    .filter((card) => company === undefined || card.company === company)
    .reduce((sum, card) => sum + card.balance, 0);

/** «ربط من كروت العهدة المتاحة (المخزن)» — the stock cards that fit the car's free slots. */
const LinkFromStockDialog = ({
  open,
  onClose,
  code,
  cards,
  pending,
  onPick,
  onAddNew,
}: {
  open: boolean;
  onClose: () => void;
  code: string;
  cards: readonly FleetFuelCardDto[];
  pending: boolean;
  onPick: (card: FleetFuelCardDto) => void;
  onAddNew?: () => void;
}): JSX.Element => {
  const t = useT();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('fleet.fuelCards.board.linkTitle', { code })}
      description={t('fleet.fuelCards.board.linkHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          {onAddNew !== undefined && (
            <Button onClick={onAddNew}>{t('fleet.fuelCards.board.addNew')}</Button>
          )}
        </>
      }
    >
      {cards.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t('fleet.fuelCards.board.linkNone')}
        </p>
      ) : (
        <ul className="space-y-2">
          {cards.map((card) => (
            <li
              key={card.id}
              data-fuel-link-choice={card.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-2.5 dark:border-slate-700"
            >
              <div className="flex items-center gap-3">
                <CompanyBadge company={card.company} />
                <div>
                  <p className="font-figures text-xs font-bold">{card.name}</p>
                  <p
                    className="font-figures text-[11px] text-slate-500 dark:text-slate-400"
                    dir="ltr"
                  >
                    {groupCardNumber(card.number)}
                    {card.label !== null ? ` · ${card.label}` : ''}
                  </p>
                </div>
              </div>
              <Button size="sm" loading={pending} onClick={() => onPick(card)}>
                {t('fleet.fuelCards.board.linkPick')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
};
