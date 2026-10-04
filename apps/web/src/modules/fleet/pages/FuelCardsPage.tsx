// بطاقات الوقود (الفيز) — every car with its two card slots, Wataniya and Chill Out, then the cards
// on no car (the stock). Drawn to the owner's own design code (`FuelCardBoard`).
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  FleetSettingKeys,
  type FleetFuelCardCompany,
  type FleetFuelCardDto,
  type Locale,
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
import { formatDate } from '../../../shared/lib/format';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import {
  useAllFuelCards,
  useAllVehicles,
  useDeleteFuelCard,
  useReceiptSummary,
  useUpdateFuelCard,
} from '../api/fleet-queries';
import { VehicleCodeFilter } from '../components/VehicleCodeFilter';
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
  VehicleFuelGroup,
  expiryState,
} from '../components/FuelCardBoard';
import { groupCardNumber } from '../lib/fuel-card-number';
import { saveSheet } from '../lib/fleet-sheet';
import { printFleetReport } from '../lib/fleet-report-print';
import { useReportSignatories } from '../lib/use-report-signatories';

const REMEMBERED_FILTERS = ['vehicleCodes', 'company', 'number', 'expiresBefore'] as const;
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
  const cardFiltered = company !== '' || number !== '' || expiresBefore !== '';
  const filters = useMemo(
    () => ({
      vehicleCodes: vehicleCodes.length > 0 ? vehicleCodes : undefined,
      company: company || undefined,
      number: number || undefined,
      expiresBefore: expiresBefore || undefined,
    }),
    [paramsKey],
  );
  const { data, isLoading, isError, error, refetch } = useAllFuelCards(filters);
  const cards = data?.items ?? [];
  const noCarCards = useMemo(() => cards.filter((card) => card.vehicleId === null), [cards]);
  // Every active car of the registry has its block — one with no card says so and offers the
  // stock. A filter on the card shows only the cars whose cards answer it; a filter on the car,
  // the cars chosen, with or without cards.
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
        const chosen =
          vehicleCodes.length === 0
            ? vehicle.status === 'active'
            : vehicleCodes.includes(vehicle.code);
        if (chosen) byCar.set(vehicle.id, { vehicleId: vehicle.id, code: vehicle.code, cards: {} });
      }
    }
    return [...byCar.values()].sort((a, b) =>
      a.code.localeCompare(b.code, 'en', { numeric: true }),
    );
  }, [cards, vehicles.data, cardFiltered, vehicleCodes.join(',')]);

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
  // «استهلاك الوقود الحالي (الشهر)»: the fuel receipts written this month, for a reader who may
  // see receipts; anyone else sees the cards' balances in its place.
  const monthStart = useMemo(() => {
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString().slice(0, 10);
  }, []);
  const mayReceipts = can('fleetReceipt.view');
  const receipts = useReceiptSummary({ kind: 'fuel', from: monthStart }, mayReceipts);
  const consumption = mayReceipts && receipts.data !== undefined ? receipts.data : null;

  // «تصفية بالتاريخ»: a ready window from today, or a date of the reader's own.
  const dayFromToday = (days: number): string =>
    new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  const [customDate, setCustomDate] = useState(false);
  const datePreset =
    expiresBefore === ''
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
    if (value === '30' || value === '60') patch({ expiresBefore: dayFromToday(Number(value)) });
    else if (value === '') patch({ expiresBefore: null });
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
      formatDate(card.expiresAt, locale),
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

  const searchBox =
    'h-[34px] w-full rounded-lg border border-slate-700/80 bg-[#080C14] py-2 pe-3 ps-9 text-xs text-slate-100 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus-visible:ring-offset-0 transition';
  const selectBox =
    'h-[34px] cursor-pointer rounded-lg border border-slate-700/80 bg-[#080C14] py-0 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0';

  return (
    <PageContainer>
      <div className={cn(BOARD_FONT, 'space-y-6 text-slate-100 antialiased')}>
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
                <span className="text-emerald-400">
                  ✓ {t('fleet.fuelCards.board.kpi.carsAllLinked')}
                </span>
              ) : (
                <span className="text-amber-400">
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
            valueClass="text-emerald-400"
            unit={t('fleet.fuelCards.board.kpi.activeUnit')}
            note={
              <span className="text-slate-400">
                <span className="text-slate-300">
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
            valueClass="text-amber-400"
            unit={t('fleet.fuelCards.board.kpi.soonUnit')}
            note={
              expiredCount > 0 ? (
                <span className="text-red-400">
                  ⚠️ {t('fleet.fuelCards.board.kpi.expiredAdvice', { count: String(expiredCount) })}
                </span>
              ) : soonCount > 0 ? (
                <span className="text-amber-400">
                  ⚠️ {t('fleet.fuelCards.board.kpi.soonAdvice')}
                </span>
              ) : (
                <span className="text-emerald-400">
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
              value={latinMoney(consumption.fuelTotal)}
              unit={t('fleet.fuelCards.board.kpi.currency')}
              unitClass="font-bold text-cyan-400"
              note={
                <span className="text-slate-400">
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
              value={latinMoney(balanceOf(cards))}
              unit={t('fleet.fuelCards.board.kpi.currency')}
              unitClass="font-bold text-cyan-400"
              note={
                <span className="text-slate-400">
                  {t('fleet.fuelCards.board.kpi.balanceNote', {
                    wataniya: latinMoney(balanceOf(cards, 'wataniya')),
                    chillout: latinMoney(balanceOf(cards, 'chillout')),
                  })}
                </span>
              }
            />
          )}
        </section>

        {/* The filters, the exports and «إضافة كارت جديد» on one bar. */}
        <section className="flex flex-col items-stretch justify-between gap-4 rounded-xl border border-slate-800 bg-[#111827] p-4 md:flex-row md:items-center">
          <div className="flex w-full items-center justify-between gap-2.5 overflow-x-auto">
            <div className="flex flex-1 shrink-0 items-center gap-2">
              <div className="relative w-40 shrink-0">
                <VehicleCodeFilter
                  className={cn(
                    'w-full',
                    '[&_button[aria-haspopup]]:!w-full [&_button[aria-haspopup]]:!rounded-lg [&_button[aria-haspopup]]:!border-slate-700/80 [&_button[aria-haspopup]]:!bg-[#080C14] [&_button[aria-haspopup]]:!h-[34px] [&_button[aria-haspopup]]:!py-0 [&_button[aria-haspopup]]:!ps-9 [&_button[aria-haspopup]]:!text-xs [&_button[aria-haspopup]]:!text-slate-100',
                    '[&_button[aria-haspopup]_span]:!text-slate-400',
                  )}
                  fullWidth
                  placeholder={t('fleet.fuelCards.board.searchCar')}
                  value={vehicleCodes}
                  onChange={(next) =>
                    patch({ vehicleCodes: next.length === 0 ? null : next.join(',') })
                  }
                />
                <span className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-3">
                  <BoardIcon d={PATH.truck} className="h-4 w-4 text-emerald-400" />
                </span>
              </div>
              <div className="relative w-40 shrink-0">
                <span className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-3">
                  <BoardIcon d={PATH.card} className="h-4 w-4 text-amber-400" />
                </span>
                <Input
                  data-fuel-number-filter="true"
                  aria-label={t('fleet.fuelCards.filters.number')}
                  placeholder={t('fleet.fuelCards.board.searchNumber')}
                  value={number}
                  rule="digits"
                  onChange={(e) => patch({ number: e.target.value.replace(/\s+/gu, '') || null })}
                  tone={cn(searchBox, 'font-mono !text-xs !pl-3 !pr-9 text-right')}
                />
              </div>
              <select
                aria-label={t('fleet.fuelCards.fields.company')}
                value={company}
                onChange={(e) => patch({ company: e.target.value || null })}
                className={cn(selectBox, 'shrink-0 px-2.5')}
              >
                <option value="">{t('fleet.fuelCards.board.anyCompany')}</option>
                {FUEL_CARD_COMPANIES.map((option) => (
                  <option key={option} value={option}>
                    {t(`fleet.fuelCards.company.${option}`)}
                  </option>
                ))}
              </select>
              <div className="relative flex shrink-0 items-center">
                <span className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-2.5">
                  <BoardIcon d={PATH.calendar} className="h-3.5 w-3.5 text-cyan-400" />
                </span>
                <select
                  aria-label={t('fleet.fuelCards.filters.expiresBefore')}
                  value={datePreset}
                  onChange={(e) => pickDatePreset(e.target.value)}
                  className={cn(selectBox, 'pe-2.5 ps-7')}
                >
                  <option value="">{t('fleet.fuelCards.board.dateAll')}</option>
                  <option value="30">{t('fleet.fuelCards.board.date30')}</option>
                  <option value="60">{t('fleet.fuelCards.board.date60')}</option>
                  <option value="custom">{t('fleet.fuelCards.board.dateCustom')}</option>
                </select>
              </div>
              {datePreset === 'custom' && (
                <input
                  type="date"
                  aria-label={t('fleet.fuelCards.filters.expiresBefore')}
                  value={expiresBefore}
                  onChange={(e) => patch({ expiresBefore: e.target.value || null })}
                  className={cn(selectBox, 'shrink-0 px-2.5 [color-scheme:dark]')}
                />
              )}
            </div>
            {!isError && (
              <div className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-slate-700 bg-slate-800/80 p-0.5">
                <button
                  type="button"
                  data-export="fuel-cards"
                  title={t('fleet.fuelCards.board.excel')}
                  onClick={() => void exportSheet()}
                  className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-emerald-950/60 hover:text-emerald-300"
                >
                  <BoardIcon d={PATH.excel} className="h-3.5 w-3.5 text-emerald-400" />
                  <span>{t('fleet.fuelCards.board.excel')}</span>
                </button>
                <span className="h-4 w-px bg-slate-700" />
                <button
                  type="button"
                  data-print="fuel-cards"
                  title={t('fleet.fuelCards.board.pdf')}
                  onClick={onPrint}
                  className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-red-950/40 hover:text-red-400"
                >
                  <BoardIcon d={PATH.pdf} className="h-3.5 w-3.5 text-red-400" />
                  <span>{t('fleet.fuelCards.board.pdf')}</span>
                </button>
              </div>
            )}
            {can('fleetFuelCard.create') && (
              <button
                type="button"
                data-fuel-add-new="true"
                onClick={() => setAdding({ vehicleId: '' })}
                className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-3.5 py-2 text-xs font-black text-white shadow-md shadow-emerald-700/25 transition hover:from-emerald-500 hover:to-teal-500"
              >
                <BoardIcon d={PATH.plus} className="h-3.5 w-3.5" width={2.5} />
                <span>{t('fleet.fuelCards.board.add')}</span>
              </button>
            )}
          </div>
        </section>

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
                <VehicleFuelGroup
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
                </VehicleFuelGroup>
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

/** «245,890» — the design writes money in Latin digits with thousands commas. */
const latinMoney = (value: number): string =>
  Math.round(value).toLocaleString('en-US', { maximumFractionDigits: 0 });

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
                  <p className="font-mono text-xs font-bold">{card.name}</p>
                  <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400" dir="ltr">
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
