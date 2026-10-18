// /atm/map/unlocated «ماكينات بدون موقع» (docs/12-planning/atm-map-zones.md §8.3, S5) — the machines
// without a usable location and the pins under review, grouped by reason, with what places them:
// the sync from the register, the short-link conversion, a pasted link or coordinates, a click on
// the map, «اعتماد» and «تصحيح».
//
// THE SAME BRANCH AS THE MAP. S1 hands its branch over in `?branch=`; this screen checks it against
// its own `context` under S1's rule (the mockup has no branch control) and never remembers it, so a
// branch left on a shared browser cannot come back on its own (§7.5). `reasons` is the one filter
// it remembers; `q` is the list's search.
//
// EVERY ROW CAN BE ACTED ON. The list is the summary's scope — the branch's machines where the
// reader can locate (§6.4) — so «تم تحديد موقع n من m» and the rows agree, and no row offers an
// action the server would refuse.
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  joinAtmNameList,
  splitAtmNameList,
  type AtmMapLatLng,
  type AtmMapPointDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { useAppSelector } from '../../../store';
import { errorMessage } from '../../../shared/lib/errors';
import { foldIncludes } from '../../../shared/lib/fold';
import { formatNumber, localized } from '../../../shared/lib/format';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { toast } from '../../../shared/ui/toast/toast-store';
import {
  useMapContext,
  useMapLocationSummary,
  useMapPoints,
  useMapZones,
  useParseLocation,
} from '../api/map-queries';
import { MovePinBar } from '../components/map/MovePinBar';
import { UnlocatedPanel } from '../components/map/UnlocatedPanel';
import { type UnlocatedRowActions } from '../components/map/UnlocatedRow';
import {
  type CanvasDot,
  type CanvasFocus,
  type CanvasZone,
} from '../components/map/map-canvas-types';
import { NO_ZONE_GREY, needsCasing } from '../lib/map-colors';
import { branchIdOf, branchOffered, defaultMapBranch } from '../lib/map-filters';
import { membershipOf, membershipZones, zoneMembership } from '../lib/map-geometry';
import { machineMapUrl } from '../lib/map-links';
import {
  UNLOCATED_CHIP_ORDER,
  chipOf,
  parseFeedback,
  reasonChipCounts,
  rowToggle,
  type UnlocatedChip,
} from '../lib/unlocated-view';

const MapCanvas = lazy(async () => import('../components/map/MapCanvas'));

/** Remembered across visits: the reason chips. The branch comes from S1's link, never from memory. */
const REMEMBERED_FILTERS = ['reasons'] as const;

const MAP_FALLBACK = <div className="h-full w-full animate-pulse rounded-2xl bg-slate-100" />;
const EMPTY_POINTS: AtmMapPointDto[] = [];

interface Moving {
  point: AtmMapPointDto;
  at: AtmMapLatLng;
  /** The pasted text while the pin still stands where it was read (DM-45). */
  text: { text: string; expected: AtmMapLatLng } | null;
}

export const UnlocatedMachinesPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  const reasons = splitAtmNameList(sp.get('reasons') ?? '').filter((r): r is UnlocatedChip =>
    (UNLOCATED_CHIP_ORDER as readonly string[]).includes(r),
  );
  const query = sp.get('q') ?? '';
  const branchParam = sp.get('branch');
  const patch = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(sp);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    setSp(next, { replace: true });
  };

  // ── Context, then the branch (S1's rule), then the data ─────────────────────────────────────
  const context = useMapContext();
  const ctx = context.data;
  const branch =
    ctx === undefined
      ? null
      : branchOffered(branchParam, ctx)
        ? branchParam
        : defaultMapBranch(ctx);
  const ready = ctx !== undefined && branch !== null;
  const branchId = ready ? branchIdOf(branch) : null;
  const points = useMapPoints({ branchId, status: 'active' }, ready);
  const zonesQuery = useMapZones({ branchId }, ready);
  const summary = useMapLocationSummary({ branchId }, ready);

  const branchNames = useMemo(
    () => new Map((ctx?.branches ?? []).map((b) => [b.id, localized(b.name, locale)])),
    [ctx, locale],
  );
  const locatable = useMemo(
    () => new Set((ctx?.branches ?? []).filter((b) => b.canLocate).map((b) => b.id)),
    [ctx],
  );
  const allPoints = points.data?.points ?? EMPTY_POINTS;
  const zones = useMemo(
    () =>
      (zonesQuery.data?.sets ?? []).flatMap((set) =>
        [...set.zones].sort((a, b) => a.order - b.order),
      ),
    [zonesQuery.data],
  );
  const mZones = useMemo(() => membershipZones(zones), [zones]);
  const membership = useMemo(() => membershipOf(allPoints, mZones), [allPoints, mZones]);

  // ── The list: the summary's scope, then the chips, then the search ──────────────────────────
  const scoped = useMemo(
    () =>
      allPoints
        .filter((p) => locatable.has(p.branchId) && chipOf(p) !== null)
        .sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true })),
    [allPoints, locatable],
  );
  const chips = useMemo(() => reasonChipCounts(scoped), [scoped]);
  const rows = useMemo(() => {
    const text = query.trim().toLowerCase();
    return scoped.filter((p) => {
      const chip = chipOf(p);
      if (reasons.length > 0 && (chip === null || !reasons.includes(chip))) return false;
      if (text === '') return true;
      return p.code.toLowerCase().startsWith(text) || foldIncludes(p.name, query.trim());
    });
  }, [scoped, reasons.join(), query]);

  // ── Placing and moving a pin ────────────────────────────────────────────────────────────────
  const [openId, setOpenId] = useState<string | null>(null);
  const [placing, setPlacing] = useState<AtmMapPointDto | null>(null);
  const [moving, setMoving] = useState<Moving | null>(null);
  const [focus, setFocus] = useState<CanvasFocus | null>(null);
  const focusSeq = useRef(0);
  const flyTo = (at: AtmMapLatLng): void => {
    focusSeq.current += 1;
    setFocus({ seq: focusSeq.current, kind: 'point', lat: at.lat, lng: at.lng });
  };
  const reparse = useParseLocation();

  const zoneNameAt = useCallback(
    (branch: string, at: AtmMapLatLng | null): string => {
      if (at === null) return t('atm.map.filters.zoneNone');
      const m = zoneMembership({ ...at, branchId: branch }, mZones);
      return zones.find((z) => z.id === m.primary)?.name ?? t('atm.map.filters.zoneNone');
    },
    [mZones, zones, t],
  );

  const actions: UnlocatedRowActions = useMemo(
    () => ({
      onCorrect: (point) => {
        if (point.lat === null || point.lng === null) return;
        setPlacing(null);
        setMoving({ point, at: { lat: point.lat, lng: point.lng }, text: null });
        focusSeq.current += 1;
        setFocus({ seq: focusSeq.current, kind: 'point', lat: point.lat, lng: point.lng });
      },
      onPreview: (point, at, text) => {
        setPlacing(null);
        setMoving({ point, at, text: { text, expected: at } });
        focusSeq.current += 1;
        setFocus({ seq: focusSeq.current, kind: 'point', lat: at.lat, lng: at.lng });
      },
      onPlace: (point) => {
        setMoving(null);
        setPlacing(point);
      },
      zoneNameAt,
    }),
    [zoneNameAt],
  );
  const toggleRow = useCallback((machineId: string) => {
    setOpenId((current) => rowToggle(current, machineId).openId);
    setPlacing(null);
    setMoving(null);
  }, []);
  // Placing mode ends with Esc too, as well as with its own «إلغاء».
  useEffect(() => {
    if (placing === null) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPlacing(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [placing]);
  // Below `lg` the map sits under the list: bring it into view when a pin is to be placed or
  // confirmed there («تأكيد الموقع» is on the map).
  const mapSection = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (placing === null && moving === null) return;
    mapSection.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [placing?.machineId, moving?.point.machineId]);

  /** 409 `ATM_MAP_PARSE_CHANGED`: read the text again and show the new point (DM-45). */
  const readAgain = (): void => {
    const current = moving;
    if (current === null || current.text === null) return;
    reparse.mutate(
      { machineId: current.point.machineId, text: current.text.text },
      {
        onSuccess: (result) => {
          if (!result.ok) {
            toast.warning(t(parseFeedback(result).key));
            setMoving(null);
            return;
          }
          const at = { lat: result.lat, lng: result.lng };
          setMoving({ ...current, at, text: { text: current.text?.text ?? '', expected: at } });
          flyTo(at);
        },
        onError: (error) => toast.error(errorMessage(error, locale)),
      },
    );
  };

  // ── What the canvas draws: the zones faintly, the located dots, the pin ────────────────────
  const canvasZones: CanvasZone[] = useMemo(
    () =>
      zones.map((zone) => ({
        id: zone.id,
        name: zone.name,
        color: zone.color,
        cased: needsCasing(zone.color),
        points: zone.points,
        countText: '',
      })),
    [zones],
  );
  const colorById = useMemo(() => new Map(zones.map((z) => [z.id, z.color])), [zones]);
  const dots: CanvasDot[] = useMemo(
    () =>
      allPoints
        .filter((p) => p.lat !== null && p.lng !== null && p.state !== 'unlocated')
        .map((p) => {
          const primary = membership.get(p.machineId)?.primary ?? null;
          const color = primary === null ? null : (colorById.get(primary) ?? null);
          return {
            id: p.machineId,
            lat: p.lat as number,
            lng: p.lng as number,
            fill: color ?? '#ffffff',
            ring: color === null ? NO_ZONE_GREY : '#ffffff',
            ringWidth: color === null ? 2 : 1.5,
            faded: true,
            review: p.state === 'review',
          };
        }),
    [allPoints, membership, colorById],
  );

  const progressFigure = (
    <span
      data-unlocated-figure="true"
      className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[13px] dark:border-slate-800 dark:bg-[#111827]"
    >
      <span className="text-slate-500 dark:text-slate-400">
        {t('atm.map.unlocated.progress', {
          done: formatNumber(summary.data?.located, locale),
          total: formatNumber(summary.data?.totalActive, locale),
        })}
      </span>
    </span>
  );

  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  return (
    <PageContainer fullHeight>
      <PageHeader
        title={t('atm.map.unlocated.title')}
        figures={progressFigure}
        actions={
          <Link
            to={machineMapUrl(branch)}
            className="inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            {t('atm.map.unlocated.back')}
          </Link>
        }
      />
      {ctx !== undefined && ctx.branches.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          {t('atm.map.empty.noBranches')}
        </p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
          <aside
            aria-label={t('atm.map.unlocated.title')}
            className="max-h-[50vh] shrink-0 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 lg:max-h-none lg:w-[440px] dark:border-slate-800 dark:bg-slate-900"
          >
            <UnlocatedPanel
              locale={locale}
              branchId={branchId}
              summary={summary.data}
              chips={chips}
              selectedReasons={reasons}
              rows={rows}
              anyRows={scoped.length > 0}
              query={query}
              openId={openId}
              branchNames={branchNames}
              actions={actions}
              onToggleReason={(chip) => {
                const next = reasons.includes(chip)
                  ? reasons.filter((r) => r !== chip)
                  : [...reasons, chip];
                patch({ reasons: next.length === 0 ? null : joinAtmNameList(next) });
              }}
              onQuery={(text) => patch({ q: text })}
              onToggleRow={toggleRow}
            />
          </aside>
          <section ref={mapSection} className="min-h-[420px] min-w-0 flex-1">
            <Suspense fallback={MAP_FALLBACK}>
              <MapCanvas
                ariaLabel={t('atm.map.aria')}
                editing={false}
                faded={false}
                zones={canvasZones}
                showZones
                zoneFill={0.12}
                showLabels={false}
                zonesInteractive={false}
                highlightZoneId={null}
                dots={dots}
                showDots
                dotsInteractive={false}
                cluster={false}
                clusterColor={null}
                onPlace={
                  placing === null
                    ? null
                    : (at) => {
                        setMoving({ point: placing, at, text: null });
                        setPlacing(null);
                      }
                }
                pin={
                  moving === null
                    ? null
                    : {
                        lat: moving.at.lat,
                        lng: moving.at.lng,
                        code: moving.point.code,
                        // A pin the person moved is sent as the point itself (§8.8).
                        onMove: (at) =>
                          setMoving((m) => (m === null ? m : { ...m, at, text: null })),
                      }
                }
                fitKey={points.isSuccess && zonesQuery.isSuccess ? String(branch) : null}
                focus={focus}
              >
                {placing !== null && (
                  <div
                    role="status"
                    dir={dir}
                    data-placing-hint="true"
                    className="pointer-events-none absolute left-1/2 top-3 z-[1100] flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-slate-900 py-1.5 pe-1.5 ps-3.5 text-[13px] text-white"
                  >
                    {t('atm.map.move.clickHint', { code: placing.code })}
                    <button
                      type="button"
                      onClick={() => setPlacing(null)}
                      className="pointer-events-auto rounded-full bg-white/15 px-2.5 py-0.5 text-xs hover:bg-white/25"
                    >
                      {t('atm.map.move.cancel')}
                    </button>
                  </div>
                )}
                {moving !== null && (
                  <MovePinBar
                    key={moving.point.machineId}
                    machine={{ machineId: moving.point.machineId, code: moving.point.code }}
                    at={moving.at}
                    text={moving.text}
                    locale={locale}
                    zoneNameAt={(at) => zoneNameAt(moving.point.branchId, at)}
                    onDone={() => setMoving(null)}
                    onCancel={() => setMoving(null)}
                    onParseChanged={readAgain}
                  />
                )}
              </MapCanvas>
            </Suspense>
          </section>
        </div>
      )}
    </PageContainer>
  );
};
