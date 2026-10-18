// /atm/map «خريطة الماكينات» (docs/12-planning/atm-map-zones.md §8.3, S1) — every machine in the
// reader's reach on an OpenStreetMap base, coloured by zone or by bank, with figures, filters, the
// zone panel, one zone's details and a machine's popup; and its edit mode (S2/S3), where one
// branch's zones are drawn, reshaped, renamed, recoloured, reordered and deleted, then saved
// together.
//
// THE CONTEXT FIRST (§8.3). `context` says which branches the reader may see and where a zone save
// is filed. Until it has answered, nothing else is asked; a branch from the address bar or from
// this browser's memory that it does not offer is replaced by the default before any query is
// enabled, so a stale or foreign branch never reaches the server as a 400 `OUT_OF_REACH`.
//
// THE PAGE READS THE ADDRESS BAR ITSELF (§7.5). It declares what it remembers and reads every param
// with `sp.get` in this file; `lib/map-filters.ts` turns the strings into values. `q` (the fly-to
// search) and `machine` (a link that opens one popup) are read but never remembered.
//
// ONE MEMBERSHIP RULE, TWO COUNTS (§6.4). In view mode a zone's count is its machines among the
// points the filters let through. In edit mode every count is over ALL the edit branch's active
// machines, whatever the filters say — the editor is changing what those machines belong to.
//
// LEAFLET IS LAZY. `MapCanvas` is the only file that imports Leaflet, mounted here through
// `React.lazy`; the page and `lib/` never import it, and the suite (no DOM) sees the fallback.
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  pointInPolygon,
  polygonsOverlap,
  type AtmMapLatLng,
  type AtmMapPointDto,
  type AtmMapZoneSetDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer } from '../../../platform/layout/PageContainer';
import { useAppSelector } from '../../../store';
import { errorMessage } from '../../../shared/lib/errors';
import { localized } from '../../../shared/lib/format';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { Button } from '../../../shared/ui/Button';
import { Dialog } from '../../../shared/ui/Dialog';
import { SideLayer } from '../../../shared/ui/SideLayer';
import { StrokeIcon } from '../../../shared/ui/StrokeIcon';
import { SidebarIcon } from '../../../shared/ui/icons';
import { toast } from '../../../shared/ui/toast/toast-store';
import { getMapZones } from '../api/map-api';
import {
  mapZonesKey,
  useMapContext,
  useMapPoints,
  useMapZones,
  useSaveZoneSet,
} from '../api/map-queries';
import { BankLegend } from '../components/map/BankLegend';
import { ConflictDialog } from '../components/map/ConflictDialog';
import { DeleteZoneDialog } from '../components/map/DeleteZoneDialog';
import { DraftRestoreNotice } from '../components/map/DraftRestoreNotice';
import { DrawPanel } from '../components/map/DrawPanel';
import { EditPanel, type EditPanelSelection } from '../components/map/EditPanel';
import { EditStrip } from '../components/map/EditStrip';
import { MachinePopup } from '../components/map/MachinePopup';
import { MapFigures } from '../components/map/MapFigures';
import { MapFilters, type MapFilterPatch } from '../components/map/MapFilters';
import { MapPageHeader } from '../components/map/MapPageHeader';
import { MapPanel } from '../components/map/MapPanel';
import { MovePinBar } from '../components/map/MovePinBar';
import { SaveSummaryDialog } from '../components/map/SaveSummaryDialog';
import { VertexChip } from '../components/map/VertexChip';
import { ZoneDetail } from '../components/map/ZoneDetail';
import { type ZoneRow } from '../components/map/ZoneList';
import { MAP_ICON } from '../components/map/map-icons';
import {
  type CanvasAnchor,
  type CanvasDot,
  type CanvasFocus,
  type CanvasView,
  type CanvasZone,
} from '../components/map/map-canvas-types';
import {
  bankColor,
  needsCasing,
  paleBank,
  CASING_INK,
  NO_ZONE_GREY,
  suggestColor,
} from '../lib/map-colors';
import { machineCountText, zoneLabelCountText } from '../lib/map-count-text';
import {
  BRANCH_ALL,
  ZONE_MULTI,
  ZONE_NONE,
  applyMapFilters,
  branchIdOf,
  mapFigures,
  parseMapFilters,
  pruneStale,
} from '../lib/map-filters';
import {
  NO_MEMBERSHIP,
  boxOf,
  coordKey,
  linkedVertices,
  membershipOf,
  membershipZones,
  overlapsOf,
  zoneMembership,
  type Membership,
  type MembershipZone,
} from '../lib/map-geometry';
import { unlocatedMachinesUrl } from '../lib/map-links';
import { nextMembership, primaryCounts } from '../lib/map-membership';
import {
  loadLayerPrefs,
  loadSnapPrefs,
  saveLayerPrefs,
  saveSnapPrefs,
  type MapLayerPrefs,
  type MapSnapPrefs,
} from '../lib/map-prefs';
import { shortcutFor } from '../lib/map-shortcuts';
import { noticeToast } from '../lib/map-toasts';
import {
  areasOf,
  findMachine,
  mapFitKey,
  saveSummary,
  zoneBreakdown,
  zoneEditableFromDetail,
} from '../lib/map-view';
import { zoneSaveFailure } from '../lib/map-errors';
import { useMinWidth } from '../lib/useMinWidth';
import { useUnsavedGuard } from '../lib/useUnsavedGuard';
import {
  SAVE_BODY_MAX_BYTES,
  buildZoneSetSave,
  dirtyCount,
  draftOf,
  duplicateNames,
  initialZoneEditorState,
  isTempId,
  newTempId,
  saveBodyBytes,
  selectedZone,
  zoneEditorReducer,
  type DraftZone,
} from '../lib/zone-editor';
import {
  autosaveAction,
  clearDraft,
  draftOffer,
  loadDraft,
  saveDraft,
  type StoredDraft,
} from '../lib/zone-draft-storage';

const MapCanvas = lazy(async () => import('../components/map/MapCanvas'));

/** Remembered across visits: the view filters and the branch. `q` and `machine` are not filters. */
const REMEMBERED_FILTERS = ['banks', 'areas', 'zones', 'status', 'loc', 'branch'] as const;

/** Editing is offered from this width; below it the page is view only (DM-40). */
const EDIT_MIN_WIDTH = 768;
/** From this width the panel sits beside the map; below it, in a `SideLayer` (DM-40). */
const PANEL_MIN_WIDTH = 1024;

const MAP_FALLBACK = <div className="h-full w-full animate-pulse rounded-2xl bg-slate-100" />;

const EMPTY_POINTS: AtmMapPointDto[] = [];

const hasPoint = (p: AtmMapPointDto): p is AtmMapPointDto & { lat: number; lng: number } =>
  p.lat !== null && p.lng !== null && p.state !== 'unlocated';

/** The noticing a reducer notice deserves: what went wrong is an error, the rest is information. */
const NOTICE_TONE: Record<string, 'success' | 'info' | 'error'> = {
  'atm.map.save.saved': 'success',
  'atm.map.draw.added': 'success',
  'atm.map.draw.cancelled': 'info',
  'atm.map.draw.crossing': 'error',
  'atm.map.draw.tooSmall': 'error',
  'atm.map.save.error.geometry': 'error',
};

export const MachineMapPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const userId = useAppSelector((state) => state.auth.me?.id ?? '');
  const can = useCan();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  const wide = useMinWidth(EDIT_MIN_WIDTH);
  const panelBeside = useMinWidth(PANEL_MIN_WIDTH);
  const rootRef = useRef<HTMLDivElement>(null);

  // ── The address bar ─────────────────────────────────────────────────────────────────────────
  const raw = parseMapFilters({
    banks: sp.get('banks'),
    areas: sp.get('areas'),
    zones: sp.get('zones'),
    status: sp.get('status'),
    loc: sp.get('loc'),
    branch: sp.get('branch'),
    q: sp.get('q'),
    machine: sp.get('machine'),
  });
  /** Replaces rather than pushes: a filter is a view of this screen, not a place to go Back to. */
  const patch = (updates: Record<string, string | null | undefined>): void => {
    const next = new URLSearchParams(sp);
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) continue;
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    setSp(next, { replace: true });
  };

  // ── Context, then the branch, then the data (§8.3) ──────────────────────────────────────────
  const context = useMapContext();
  const ctx = context.data;
  const branchOnly =
    ctx === undefined
      ? null
      : pruneStale(raw, {
          branches: ctx.branches,
          organizationWide: ctx.organizationWide,
          editBranchId: ctx.editBranchId,
        }).branch;
  const ready = ctx !== undefined && branchOnly !== null;
  const branchId = ready ? branchIdOf(branchOnly) : null;
  const points = useMapPoints({ branchId, status: raw.status }, ready);
  const zonesQuery = useMapZones({ branchId }, ready);
  const allPoints = points.data?.points ?? EMPTY_POINTS;
  const sets = useMemo(() => zonesQuery.data?.sets ?? [], [zonesQuery.data]);
  const viewZones = useMemo(
    () => sets.flatMap((set) => [...set.zones].sort((a, b) => a.order - b.order)),
    [sets],
  );
  const areas = useMemo(() => areasOf(allPoints), [allPoints]);
  const filters =
    ctx === undefined
      ? raw
      : pruneStale(raw, {
          branches: ctx.branches,
          organizationWide: ctx.organizationWide,
          editBranchId: ctx.editBranchId,
          ...(zonesQuery.data === undefined ? {} : { zones: viewZones.map((z) => z.id) }),
          ...(points.data === undefined ? {} : { areas }),
        });
  // What the address bar says and what is on offer agree, written back once they do not.
  const staleKey = [
    filters.branch !== raw.branch ? `b:${String(filters.branch)}` : '',
    filters.zones.join() !== raw.zones.join() ? `z:${filters.zones.join()}` : '',
    filters.areas.join() !== raw.areas.join() ? `a:${filters.areas.join()}` : '',
  ].join('|');
  useEffect(() => {
    if (ctx === undefined || staleKey === '||') return;
    const fix: Record<string, string | null> = {};
    if (filters.branch !== raw.branch) fix['branch'] = filters.branch;
    if (filters.zones.join() !== raw.zones.join()) fix['zones'] = filters.zones.join(',') || null;
    if (filters.areas.join() !== raw.areas.join()) fix['areas'] = filters.areas.join(',') || null;
    patch(fix);
  }, [staleKey]);

  const branchNames = useMemo(
    () => new Map((ctx?.branches ?? []).map((b) => [b.id, localized(b.name, locale)])),
    [ctx, locale],
  );
  const canLocateIn = (id: string): boolean =>
    can('atmMachine.locate') && (ctx?.branches.find((b) => b.id === id)?.canLocate ?? false);

  // ── View-mode membership, visible points and figures (§6.4) ────────────────────────────────
  const viewMZones = useMemo(() => membershipZones(viewZones), [viewZones]);
  const viewMembership = useMemo(
    () => membershipOf(allPoints, viewMZones),
    [allPoints, viewMZones],
  );
  const visible = useMemo(
    () => applyMapFilters(allPoints, viewMembership, filters),
    [
      allPoints,
      viewMembership,
      filters.banks.join(),
      filters.areas.join(),
      filters.zones.join(),
      filters.status,
      filters.loc,
    ],
  );
  const figures = points.data === undefined ? undefined : mapFigures(visible, viewMembership);
  const viewCounts = useMemo(
    () =>
      primaryCounts(
        viewMembership,
        visible.map((p) => p.machineId),
      ),
    [viewMembership, visible],
  );

  // ── Viewer preferences (DM-30) ──────────────────────────────────────────────────────────────
  const [layers, setLayers] = useState<MapLayerPrefs>(() => loadLayerPrefs());
  const [snap, setSnap] = useState<MapSnapPrefs>(() => loadSnapPrefs());
  const changeLayers = (next: MapLayerPrefs): void => {
    setLayers(next);
    saveLayerPrefs(next);
  };
  const changeSnap = (next: MapSnapPrefs): void => {
    setSnap(next);
    saveSnapPrefs(next);
  };

  // ── The editor (§8.6) ───────────────────────────────────────────────────────────────────────
  // `send`, not `dispatch`: the remembered-filters census reads the keys of every object handed to a
  // call whose name ends in "patch" as params this page writes — and "dispatch" ends in it.
  const [editor, send] = useReducer(zoneEditorReducer, initialZoneEditorState);
  const editing = editor.mode !== 'view';
  const editBranchId = ctx?.editBranchId ?? null;
  // In edit mode, all the edit branch's active machines (§6.4); in view mode the same query as the
  // view's, so the two observers share one cache entry and ask nothing more.
  const editPoints = useMapPoints(
    editing ? { branchId: editor.branchId, status: 'active' } : { branchId, status: raw.status },
    editing ? editor.branchId !== null : ready,
  );
  const editList = editPoints.data?.points ?? EMPTY_POINTS;
  const editIds = useMemo(() => editList.map((p) => p.machineId), [editList]);
  const editLocated = useMemo(() => editList.filter(hasPoint), [editList]);
  const dirty = editing ? dirtyCount(editor.base, editor.draft) : 0;
  const baseDraft = useMemo(
    () => (editor.base === null ? [] : draftOf(editor.base)),
    [editor.base],
  );
  const toMZones = (draft: readonly DraftZone[]): MembershipZone[] =>
    membershipZones(
      draft.map((z) => ({ id: z.id, branchId: editor.branchId ?? '', points: z.points })),
    );
  const draftMZones = useMemo(() => toMZones(editor.draft), [editor.draft, editor.branchId]);
  const baseMZones = useMemo(() => toMZones(baseDraft), [baseDraft, editor.branchId]);
  // Live counts while a zone is reshaped: only the machines the drag can reach are recomputed
  // (§8.4); the canvas moves a vertex at most once per animation frame.
  const editMemo = useRef<Parameters<typeof nextMembership>[0]>(null);
  const editMembership = useMemo(() => {
    const result = nextMembership(editMemo.current, editList, draftMZones);
    editMemo.current = { zones: draftMZones, points: editList, result };
    return result;
  }, [editList, draftMZones]);
  const baseMembership = useMemo(() => membershipOf(editList, baseMZones), [editList, baseMZones]);
  const editCounts = useMemo(
    () => primaryCounts(editMembership, editIds),
    [editMembership, editIds],
  );
  const baseCounts = useMemo(
    () => primaryCounts(baseMembership, editIds),
    [baseMembership, editIds],
  );
  // The aria-live counts move at gesture end only (§8.11).
  const settledCounts = useRef(editCounts);
  if (editor.gesture === null) settledCounts.current = editCounts;

  const [draftKept, setDraftKept] = useState(true);
  const [draftNotice, setDraftNotice] = useState<
    { kind: 'restore'; stored: StoredDraft } | { kind: 'outdated' } | null
  >(null);
  const [confirm, setConfirm] = useState<{ body: string; go: () => void } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const save = useSaveZoneSet();
  const guard = useUnsavedGuard({
    dirty: dirty > 0,
    onLeave: () => {
      if (editor.branchId !== null) clearDraft(userId, editor.branchId);
    },
    rootRef,
  });

  // Reducer notices become one toast each.
  useEffect(() => {
    const notice = editor.notice;
    if (notice === null) return;
    const tone = NOTICE_TONE[notice.key] ?? 'info';
    const words = noticeToast(notice.key, t);
    toast[tone](words.title, words.description);
  }, [editor.notice?.seq]);

  // The draft is kept on this device after each finished step (DM-29); a clean draft is not a
  // draft — but one still offered for restoring stays stored until the person chooses.
  const offerPending = draftNotice?.kind === 'restore';
  const gestureActive = editor.gesture !== null;
  useEffect(() => {
    if (!editing || editor.base === null || editor.branchId === null || userId === '') return;
    const action = autosaveAction({ gestureActive, offerPending, dirty });
    if (action === 'clear') clearDraft(userId, editor.branchId);
    if (action !== 'save') return;
    setDraftKept(
      saveDraft(userId, editor.branchId, {
        baseRevision: editor.base.revision,
        draft: editor.draft,
        savedAt: new Date().toISOString(),
      }),
    );
  }, [editor.past, editor.future, editor.draft, editor.base, gestureActive, offerPending]);

  const fetchEditSet = async (id: string): Promise<AtmMapZoneSetDto> => {
    const answer = await queryClient.fetchQuery({
      queryKey: mapZonesKey({ branchId: id }),
      queryFn: () => getMapZones({ branchId: id }),
      staleTime: 0,
    });
    return (
      answer.sets.find((set) => set.branchId === id) ?? { branchId: id, revision: 0, zones: [] }
    );
  };

  const [entering, setEntering] = useState(false);
  const enterEdit = async (selectZoneId: string | null, thenDraw = false): Promise<void> => {
    if (editBranchId === null || entering) return;
    setEntering(true);
    try {
      // A fresh read: its revision is the base every save is checked against (DM-7).
      const set = await fetchEditSet(editBranchId);
      closePopup();
      setDetailId(null);
      setMoving(null);
      send({ type: 'ENTER_EDIT', set, selectZoneId });
      if (filters.branch !== editBranchId) patch({ branch: editBranchId });
      // The zone being edited is brought into view — after the edit branch's own fit, if any.
      pendingFocus.current =
        selectZoneId !== null && set.zones.some((z) => z.id === selectZoneId)
          ? { kind: 'zone', zoneId: selectZoneId }
          : null;
      const offer = draftOffer(loadDraft(userId, editBranchId), set.revision);
      if (offer === 'outdated') {
        clearDraft(userId, editBranchId);
        setDraftNotice({ kind: 'outdated' });
      } else if (offer === 'restore') {
        const stored = loadDraft(userId, editBranchId);
        if (stored !== null) setDraftNotice({ kind: 'restore', stored });
      } else {
        setDraftNotice(null);
      }
      if (thenDraw) {
        send({ type: 'START_DRAW', color: suggestColor(draftOf(set), null) });
      }
    } catch (error) {
      toast.error(errorMessage(error, locale));
    } finally {
      setEntering(false);
    }
  };

  const exitEdit = (): void => {
    guard.confirmLeave(() => {
      send({ type: 'EXIT_EDIT' });
      setDraftNotice(null);
      setDeleting(null);
      setSummaryOpen(false);
    });
  };

  const discard = (): void => {
    const run = async (): Promise<void> => {
      if (editor.branchId === null) return;
      try {
        const set = await fetchEditSet(editor.branchId);
        send({ type: 'DISCARD', set });
      } catch (error) {
        toast.error(errorMessage(error, locale));
        send({ type: 'DISCARD' });
      }
      clearDraft(userId, editor.branchId);
    };
    if (dirty === 0) void run();
    else setConfirm({ body: t('atm.map.discard.body'), go: () => void run() });
  };

  const openSave = (): void => {
    if (editor.base === null || dirty === 0) return;
    if (duplicateNames(editor.draft).length > 0) {
      toast.error(t('atm.map.save.error.duplicateName'));
      return;
    }
    if (saveBodyBytes(buildZoneSetSave(editor.base, editor.draft)) > SAVE_BODY_MAX_BYTES) {
      toast.error(t('atm.map.save.error.tooManyPoints'));
      return;
    }
    setSummaryOpen(true);
  };

  const confirmSave = (): void => {
    if (editor.base === null) return;
    const body = buildZoneSetSave(editor.base, editor.draft);
    const branch = editor.branchId;
    save.mutate(body, {
      onSuccess: (set) => {
        setSummaryOpen(false);
        send({ type: 'SAVED', set });
        if (branch !== null) clearDraft(userId, branch);
      },
      onError: (error) => {
        setSummaryOpen(false);
        const failure = zoneSaveFailure(error);
        if (failure === null) {
          toast.error(errorMessage(error, locale));
        } else if (failure.kind === 'conflict') {
          send({ type: 'CONFLICT' });
        } else if (failure.kind === 'reload') {
          // The top bar's branch changed in another tab (`BranchSwitcher`); this tab must reload.
          toast.warning(t(failure.key));
          window.setTimeout(() => window.location.reload(), 1500);
        } else {
          toast.error(t(failure.key));
        }
      },
    });
  };

  // ── Popup, details, search, move ────────────────────────────────────────────────────────────
  const [popupId, setPopupId] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [hoverZone, setHoverZone] = useState<string | null>(null);
  const [focus, setFocus] = useState<CanvasFocus | null>(null);
  const focusSeq = useRef(0);
  const flyTo = (
    target: { kind: 'point'; lat: number; lng: number } | { kind: 'zone'; zoneId: string },
  ): void => {
    focusSeq.current += 1;
    setFocus({ ...target, seq: focusSeq.current });
  };
  // The default view (§8.4): once per branch and status, never because the mode changed.
  const fitKey = mapFitKey({
    editing,
    viewBranch: filters.branch,
    editBranch: editor.branchId,
    status: raw.status,
    viewReady: points.isSuccess && zonesQuery.isSuccess,
    editReady: editPoints.isSuccess,
  });
  const pendingFocus = useRef<{ kind: 'zone'; zoneId: string } | null>(null);
  useEffect(() => {
    if (pendingFocus.current === null || fitKey === null) return;
    flyTo(pendingFocus.current);
    pendingFocus.current = null;
  }, [fitKey, editing]);
  const [moving, setMoving] = useState<{ point: AtmMapPointDto; at: AtmMapLatLng } | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const view = useRef<CanvasView | null>(null);

  const openPopup = (machineId: string): void => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPopupId(machineId);
  };
  function closePopup(): void {
    setPopupId(null);
    const back = opener.current;
    opener.current = null;
    back?.focus({ preventScroll: true });
  }

  const pointById = useMemo(() => new Map(allPoints.map((p) => [p.machineId, p])), [allPoints]);
  const search = (text: string): void => {
    patch({ q: text.trim() === '' ? null : text.trim() });
    const found = findMachine(allPoints, text);
    if (found === null) {
      if (text.trim() !== '') toast.info(t('atm.map.search.notFound'));
      return;
    }
    if (!hasPoint(found)) {
      // Toasts carry no action (DM-31); the «بدون موقع» figure is the way to that list.
      toast.info(t('atm.map.search.unlocated', { code: found.code }));
      return;
    }
    flyTo({ kind: 'point', lat: found.lat, lng: found.lng });
    openPopup(found.machineId);
  };
  // `?q=` and `?machine=` from a link act once, when the points have arrived — after the map's
  // first fit (`fitKey`), which would otherwise take the view back to the whole branch.
  const linked = useRef(false);
  useEffect(() => {
    if (linked.current || points.data === undefined || fitKey === null) return;
    linked.current = true;
    const machine = filters.machine === null ? undefined : pointById.get(filters.machine);
    if (machine !== undefined && hasPoint(machine)) {
      flyTo({ kind: 'point', lat: machine.lat, lng: machine.lng });
      setPopupId(machine.machineId);
    } else if (filters.q.trim() !== '') {
      search(filters.q);
    }
  }, [points.data, fitKey]);

  /** «القطاع: …» for a point of a machine's branch — the shared membership (DM-9). */
  const zoneNameAt = useCallback(
    (branch: string, at: AtmMapLatLng | null): string => {
      if (at === null) return t('atm.map.filters.zoneNone');
      const m = zoneMembership({ ...at, branchId: branch }, viewMZones);
      const zone = viewZones.find((z) => z.id === m.primary);
      return zone?.name ?? t('atm.map.filters.zoneNone');
    },
    [viewMZones, viewZones, t],
  );

  // ── Keyboard (§8.5 map-shortcuts, DM-41) ────────────────────────────────────────────────────
  const modalOpen =
    confirm !== null ||
    deleting !== null ||
    summaryOpen ||
    editor.conflict ||
    guard.leaveOpen ||
    (panelOpen && !panelBeside);
  const onMapKey = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (!editing) return;
    const action = shortcutFor(event.nativeEvent, { modalOpen });
    if (action === null) return;
    const draw = editor.mode === 'draw';
    switch (action.kind) {
      case 'newZone':
        if (editor.mode === 'edit') {
          send({ type: 'START_DRAW', color: suggestColor(editor.draft, null) });
        }
        break;
      case 'finish':
        if (!draw) return;
        finishDraw();
        break;
      case 'cancel':
        if (!draw) return;
        send({ type: 'CANCEL_DRAW' });
        break;
      case 'removePoint':
        if (draw) send({ type: 'UNDO_POINT' });
        else if (editor.selectedVertex !== null) send({ type: 'DELETE_VERTEX' });
        else return;
        break;
      case 'undo':
        // While drawing, Ctrl+Z takes back the last dot (§8.6 UNDO_POINT), not the last step.
        send({ type: draw ? 'UNDO_POINT' : 'UNDO' });
        break;
      case 'redo':
        send({ type: 'REDO' });
        break;
      case 'nudge': {
        const vertex = editor.selectedVertex;
        const zone = vertex === null ? undefined : editor.draft.find((z) => z.id === vertex.zoneId);
        const at = vertex === null ? undefined : zone?.points[vertex.index];
        if (draw || vertex === null || at === undefined || view.current === null) return;
        const px = view.current.project(at);
        const next = view.current.unproject({ x: px.x + action.dx, y: px.y + action.dy });
        send({
          type: 'MOVE_VERTEX',
          zoneId: vertex.zoneId,
          index: vertex.index,
          point: next,
          unlink: false,
        });
        send({ type: 'END_GESTURE' });
        break;
      }
    }
    event.preventDefault();
  };

  const finishDraw = (): void => {
    send({
      type: 'FINISH_DRAW',
      tempId: newTempId(editor.draft),
      formatName: (n) => t('atm.map.edit.defaultName', { n: String(n) }),
    });
  };

  // ── What the canvas draws ───────────────────────────────────────────────────────────────────
  const colorOf = (
    zoneColor: string | null,
    bankCode: AtmMapPointDto['bankCode'],
  ): Omit<CanvasDot, 'id' | 'lat' | 'lng' | 'faded' | 'review'> => {
    if (layers.colorBy === 'bank') {
      return {
        fill: bankColor(bankCode),
        ring: paleBank(bankCode) ? CASING_INK : '#ffffff',
        ringWidth: 1.5,
      };
    }
    return zoneColor === null
      ? { fill: '#ffffff', ring: NO_ZONE_GREY, ringWidth: 2 }
      : { fill: zoneColor, ring: '#ffffff', ringWidth: 1.5 };
  };

  const zoneColorById = useMemo(() => {
    const colors = new Map<string, string>();
    for (const zone of editing ? editor.draft : viewZones) colors.set(zone.id, zone.color);
    return colors;
  }, [editing, editor.draft, viewZones]);

  const canvasZones: CanvasZone[] = useMemo(() => {
    if (editing) {
      return editor.draft.map((zone) => ({
        id: zone.id,
        name: zone.name,
        color: zone.color,
        cased: needsCasing(zone.color),
        points: zone.points,
        countText: zoneLabelCountText(editCounts.get(zone.id) ?? 0, locale),
      }));
    }
    return viewZones.map((zone) => ({
      id: zone.id,
      name: zone.name,
      color: zone.color,
      cased: needsCasing(zone.color),
      points: zone.points,
      countText: zoneLabelCountText(viewCounts.get(zone.id) ?? 0, locale),
    }));
  }, [editing, editor.draft, editCounts, viewZones, viewCounts, locale]);

  const dots: CanvasDot[] = useMemo(() => {
    const source = editing ? editLocated : visible.filter(hasPoint);
    const membership: ReadonlyMap<string, Membership> = editing ? editMembership : viewMembership;
    return source.filter(hasPoint).map((p) => {
      const primary = (membership.get(p.machineId) ?? NO_MEMBERSHIP).primary;
      return {
        id: p.machineId,
        lat: p.lat,
        lng: p.lng,
        ...colorOf(primary === null ? null : (zoneColorById.get(primary) ?? null), p.bankCode),
        faded: !p.active,
        review: p.state === 'review',
      };
    });
  }, [
    editing,
    editLocated,
    visible,
    editMembership,
    viewMembership,
    zoneColorById,
    layers.colorBy,
  ]);

  const oneZone =
    filters.zones.length === 1 && filters.zones[0] !== ZONE_NONE && filters.zones[0] !== ZONE_MULTI
      ? (zoneColorById.get(filters.zones[0] as string) ?? null)
      : null;

  const popupPoint = popupId === null ? undefined : pointById.get(popupId);
  const anchors: CanvasAnchor[] = [];
  if (!editing && popupPoint !== undefined && hasPoint(popupPoint) && moving === null) {
    const m = viewMembership.get(popupPoint.machineId) ?? NO_MEMBERSHIP;
    const named = (id: string): string => viewZones.find((z) => z.id === id)?.name ?? '';
    const primary = m.primary === null ? null : viewZones.find((z) => z.id === m.primary);
    anchors.push({
      key: `popup-${popupPoint.machineId}`,
      lat: popupPoint.lat,
      lng: popupPoint.lng,
      placement: 'popup',
      content: (
        <MachinePopup
          point={popupPoint}
          branchName={branchNames.get(popupPoint.branchId) ?? ''}
          zone={{
            primary:
              primary === undefined || primary === null
                ? null
                : { name: primary.name, color: primary.color },
            all: m.all.map(named),
          }}
          locale={locale}
          canOpenRegister={can('atmRegister.view')}
          canMove={canLocateIn(popupPoint.branchId)}
          onClose={closePopup}
          onMove={() => {
            setPopupId(null);
            setMoving({ point: popupPoint, at: { lat: popupPoint.lat, lng: popupPoint.lng } });
          }}
          onNavigate={(to) => guard.confirmLeave(() => navigate(to))}
        />
      ),
    });
  }
  const selected = editing ? selectedZone(editor) : null;
  const vertexAt =
    editor.mode === 'edit' && editor.selectedVertex !== null && selected !== null
      ? selected.points[editor.selectedVertex.index]
      : undefined;
  if (vertexAt !== undefined && selected !== null && editor.gesture === null) {
    const shared = linkedVertices(editor.draft, coordKey(vertexAt))
      .filter((v) => v.zoneId !== selected.id)
      .map((v) => editor.draft.find((z) => z.id === v.zoneId)?.name ?? '');
    anchors.push({
      key: 'vertex-chip',
      lat: vertexAt.lat,
      lng: vertexAt.lng,
      placement: 'chip',
      content: (
        <VertexChip
          canDelete={selected.points.length > 3}
          sharedWith={[...new Set(shared)]}
          onDelete={() => send({ type: 'DELETE_VERTEX' })}
        />
      ),
    });
  }

  // ── Edit-mode panel pieces ──────────────────────────────────────────────────────────────────
  const drawingInside =
    editor.drawing !== null && editor.drawing.points.length >= 3
      ? editLocated.filter((p) =>
          pointInPolygon(p, (editor.drawing as { points: AtmMapLatLng[] }).points),
        ).length
      : 0;
  const selection: EditPanelSelection | null =
    selected === null
      ? null
      : {
          id: selected.id,
          name: selected.name,
          color: selected.color,
          suggested: isTempId(selected.id)
            ? suggestColor(
                editor.draft.filter((z) => z.id !== selected.id),
                selected.points.length > 0 ? boxOf(selected.points) : null,
              )
            : null,
          count: settledCounts.current.get(selected.id) ?? 0,
          was:
            !isTempId(selected.id) &&
            (baseCounts.get(selected.id) ?? 0) !== (settledCounts.current.get(selected.id) ?? 0)
              ? (baseCounts.get(selected.id) ?? 0)
              : null,
          points: selected.points.length,
          overlaps: overlapsOf(selected, editor.draft, editLocated).map((o) => ({
            name: editor.draft.find((z) => z.id === o.zoneId)?.name ?? '',
            count: o.machinesInBoth,
          })),
          vertex:
            editor.selectedVertex !== null && editor.selectedVertex.zoneId === selected.id
              ? { canDelete: selected.points.length > 3 }
              : null,
        };

  const summary = useMemo(
    () =>
      summaryOpen
        ? saveSummary(baseDraft, editor.draft, editIds, baseMembership, editMembership)
        : null,
    [summaryOpen, baseDraft, editor.draft, editIds, baseMembership, editMembership],
  );
  const summaryOverlaps = useMemo(() => {
    if (!summaryOpen) return [];
    const pairs: { zone: string; other: string; count: number }[] = [];
    editor.draft.forEach((a, i) => {
      for (const b of editor.draft.slice(i + 1)) {
        if (!polygonsOverlap(a.points, b.points)) continue;
        const count = editLocated.filter(
          (p) => pointInPolygon(p, a.points) && pointInPolygon(p, b.points),
        ).length;
        pairs.push({ zone: a.name, other: b.name, count });
      }
    });
    return pairs;
  }, [summaryOpen, editor.draft, editLocated]);

  // ── View-mode panel pieces ──────────────────────────────────────────────────────────────────
  const zoneRows: ZoneRow[] = viewZones.map((zone) => ({
    id: zone.id,
    branchId: zone.branchId,
    name: zone.name,
    color: zone.color,
    count: viewCounts.get(zone.id) ?? 0,
  }));
  const detailZone = detailId === null ? undefined : viewZones.find((z) => z.id === detailId);
  const canEditZones = can('atmZone.manage') && wide;
  const detail =
    detailZone === undefined ? null : (
      <ZoneDetail
        zone={detailZone}
        breakdown={zoneBreakdown(detailZone.id, visible, viewMembership)}
        overlaps={
          overlapsOf(
            detailZone,
            viewZones.filter((z) => z.branchId === detailZone.branchId),
          ).length
        }
        locale={locale}
        onBack={() => setDetailId(null)}
        onEdit={
          zoneEditableFromDetail(detailZone.branchId, editBranchId, canEditZones)
            ? () => void enterEdit(detailZone.id)
            : null
        }
        onPickMachine={(machineId) => {
          const p = pointById.get(machineId);
          if (p === undefined || !hasPoint(p)) return;
          flyTo({ kind: 'point', lat: p.lat, lng: p.lng });
          openPopup(machineId);
        }}
      />
    );

  const branchSelect =
    ctx === undefined || ctx.branches.length <= 1
      ? null
      : {
          value: filters.branch ?? '',
          options: [
            ...(ctx.organizationWide
              ? [{ value: BRANCH_ALL, label: t('atm.map.panel.branchAll') }]
              : []),
            ...ctx.branches.map((b) => ({ value: b.id, label: localized(b.name, locale) })),
          ],
          onChange: (value: string) => {
            setDetailId(null);
            setPopupId(null);
            patch({ branch: value, zones: null });
          },
        };

  const zoneOptions = viewZones.map((zone) => ({
    value: zone.id,
    label:
      filters.branch === BRANCH_ALL
        ? `${zone.name} — ${branchNames.get(zone.branchId) ?? ''}`
        : zone.name,
  }));

  const editBranchName = editor.branchId === null ? '' : (branchNames.get(editor.branchId) ?? '');
  const panel = editing ? (
    <EditPanel
      locale={locale}
      branchName={editBranchName}
      drawPanel={
        editor.mode === 'draw' ? (
          <DrawPanel
            points={editor.drawing?.points.length ?? 0}
            inside={drawingInside}
            locale={locale}
            onFinish={finishDraw}
            onUndoPoint={() => send({ type: 'UNDO_POINT' })}
            onCancel={() => send({ type: 'CANCEL_DRAW' })}
          />
        ) : null
      }
      selection={selection}
      rows={editor.draft.map((zone) => ({
        id: zone.id,
        name: zone.name,
        color: zone.color,
        count: settledCounts.current.get(zone.id) ?? 0,
      }))}
      snap={snap}
      showNames={layers.names}
      onNewZone={() => send({ type: 'START_DRAW', color: suggestColor(editor.draft, null) })}
      onRename={(name) => selected !== null && send({ type: 'RENAME', zoneId: selected.id, name })}
      onRecolor={(hex) =>
        selected !== null && send({ type: 'RECOLOR', zoneId: selected.id, color: hex })
      }
      onDeleteVertex={() => send({ type: 'DELETE_VERTEX' })}
      onDeleteZone={() => selected !== null && setDeleting(selected.id)}
      onSnap={changeSnap}
      onPick={(zoneId) => {
        send({ type: 'SELECT_ZONE', zoneId });
        flyTo({ kind: 'zone', zoneId });
      }}
      onMoveUp={(zoneId) => send({ type: 'MOVE_UP', zoneId })}
      onMoveDown={(zoneId) => send({ type: 'MOVE_DOWN', zoneId })}
      onSortAz={() => send({ type: 'SORT_AZ' })}
      onShowNames={(on) => changeLayers({ ...layers, names: on })}
    />
  ) : (
    <MapPanel
      locale={locale}
      branch={branchSelect}
      zones={zoneRows}
      branchNames={filters.branch === BRANCH_ALL ? branchNames : null}
      detail={detail}
      figures={figures}
      layers={layers}
      onLayers={changeLayers}
      onHoverZone={setHoverZone}
      onOpenZone={(zoneId) => {
        setDetailId(zoneId);
        flyTo({ kind: 'zone', zoneId });
      }}
      onDrawFirst={
        canEditZones &&
        editBranchId !== null &&
        (branchOnly === editBranchId || ctx?.branches.length === 1)
          ? () => void enterEdit(null, true)
          : null
      }
    />
  );

  const deletingZone = deleting === null ? undefined : editor.draft.find((z) => z.id === deleting);
  const unlocatedHref = unlocatedMachinesUrl(filters.branch);
  const showUnlocated = can('atmMachine.locate');
  const noBranches = ctx !== undefined && ctx.branches.length === 0;

  const header = (
    <MapPageHeader
      title={t('atm.map.title')}
      editing={editing}
      figures={
        <MapFigures
          figures={figures}
          locale={locale}
          unlocatedLink={
            showUnlocated
              ? {
                  href: unlocatedHref,
                  onOpen: () => guard.confirmLeave(() => navigate(unlocatedHref)),
                }
              : null
          }
        />
      }
      actions={
        <>
          {showUnlocated && (
            <Button
              variant="secondary"
              onClick={() => guard.confirmLeave(() => navigate(unlocatedHref))}
            >
              {t('atm.map.actions.unlocated')}
            </Button>
          )}
          {can('atmZone.manage') && wide && (
            <Button
              data-edit-zones="true"
              onClick={() => void enterEdit(null)}
              loading={entering}
              disabled={editBranchId === null}
              title={
                ctx?.editBlocked === 'chooseBranch'
                  ? t('atm.map.edit.chooseBranch')
                  : ctx?.editBlocked === 'branchNotEditable'
                    ? t('atm.map.edit.branchNotEditable')
                    : undefined
              }
            >
              <StrokeIcon d={MAP_ICON.pencil} className="h-4 w-4" />
              {t('atm.map.actions.editZones')}
            </Button>
          )}
        </>
      }
    />
  );

  const editorProps = editing
    ? {
        mode: editor.mode === 'draw' ? ('draw' as const) : ('edit' as const),
        selectedZoneId: editor.selectedZoneId,
        selectedVertex: editor.selectedVertex,
        drawing: editor.drawing,
        snap,
        onSelectZone: (zoneId: string | null) => send({ type: 'SELECT_ZONE', zoneId }),
        onSelectVertex: (vertex: typeof editor.selectedVertex) =>
          send({ type: 'SELECT_VERTEX', vertex }),
        onMoveVertex: (zoneId: string, index: number, point: AtmMapLatLng, unlink: boolean) =>
          send({ type: 'MOVE_VERTEX', zoneId, index, point, unlink }),
        onInsertVertex: (zoneId: string, edgeIndex: number, point: AtmMapLatLng) =>
          send({ type: 'INSERT_VERTEX', zoneId, edgeIndex, point }),
        onEndGesture: () => send({ type: 'END_GESTURE' }),
        onDeleteVertex: (vertex: NonNullable<typeof editor.selectedVertex>) =>
          send({ type: 'DELETE_VERTEX', vertex }),
        onAddPoint: (point: AtmMapLatLng, pxFromLast: number | undefined) =>
          send(
            pxFromLast === undefined
              ? { type: 'ADD_POINT', point }
              : { type: 'ADD_POINT', point, pxFromLast },
          ),
        onFinishDraw: finishDraw,
      }
    : null;

  const canvas = (
    <Suspense fallback={MAP_FALLBACK}>
      <MapCanvas
        ariaLabel={editing ? t('atm.map.ariaEdit') : t('atm.map.aria')}
        editing={editing}
        faded={layers.faded}
        zones={canvasZones}
        showZones={editing || layers.zones}
        zoneFill={0.25}
        showLabels={layers.names}
        zonesInteractive={editor.mode !== 'draw' && moving === null}
        highlightZoneId={editing ? null : (hoverZone ?? detailId)}
        onZoneClick={(zoneId) => {
          setDetailId(zoneId);
          setPanelOpen(true);
        }}
        dots={dots}
        showDots={editing || layers.pins}
        dotsInteractive={!editing && moving === null}
        cluster={!editing}
        clusterColor={oneZone}
        onDotClick={openPopup}
        onMapClick={() => {
          if (popupId !== null) closePopup();
        }}
        editor={editorProps}
        pin={
          moving === null
            ? null
            : {
                lat: moving.at.lat,
                lng: moving.at.lng,
                code: moving.point.code,
                onMove: (at) => setMoving((m) => (m === null ? m : { ...m, at })),
              }
        }
        anchors={anchors}
        fitKey={fitKey}
        focus={focus}
        onView={(next) => {
          view.current = next;
        }}
        onKeyDown={onMapKey}
      >
        {!editing && layers.colorBy === 'bank' && layers.pins && <BankLegend locale={locale} />}
        {editor.mode === 'draw' && (
          <div
            role="status"
            dir={locale === 'ar' ? 'rtl' : 'ltr'}
            className="pointer-events-none absolute left-1/2 top-3 z-[1100] -translate-x-1/2 whitespace-nowrap rounded-full bg-slate-900 px-3.5 py-1.5 text-[13px] text-white"
          >
            {t('atm.map.draw.hint')}
          </div>
        )}
        {editor.mode === 'draw' && (editor.drawing?.points.length ?? 0) >= 3 && (
          <div
            aria-live="polite"
            dir={locale === 'ar' ? 'rtl' : 'ltr'}
            className="pointer-events-none absolute bottom-8 left-1/2 z-[1100] -translate-x-1/2 rounded-full bg-slate-900 px-3.5 py-1.5 text-[13px] text-white"
          >
            {t('atm.map.draw.insideChip', { count: machineCountText(drawingInside, t, locale) })}
          </div>
        )}
        {!panelBeside && (
          <button
            type="button"
            onClick={() => setPanelOpen(true)}
            className="absolute right-3 top-3 z-[1100] inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-[13px] text-slate-700 shadow"
          >
            <SidebarIcon className="h-4 w-4" />
            {t('atm.map.panel.toggle')}
          </button>
        )}
        {moving !== null && (
          <MovePinBar
            machine={{ machineId: moving.point.machineId, code: moving.point.code }}
            at={moving.at}
            text={null}
            locale={locale}
            zoneNameAt={(at) => zoneNameAt(moving.point.branchId, at)}
            onDone={() => setMoving(null)}
            onCancel={() => setMoving(null)}
          />
        )}
      </MapCanvas>
    </Suspense>
  );

  return (
    <PageContainer fullHeight>
      <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
        {header}
        {noBranches ? (
          <p
            data-map-empty="noBranches"
            className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400"
          >
            {t('atm.map.empty.noBranches')}
          </p>
        ) : (
          <>
            {editing ? (
              <EditStrip
                branchName={editBranchName}
                dirty={dirty}
                canUndo={editor.past.length > 0}
                canRedo={editor.future.length > 0}
                saving={save.isPending}
                locale={locale}
                onUndo={() => send({ type: 'UNDO' })}
                onRedo={() => send({ type: 'REDO' })}
                onDiscard={discard}
                onSave={openSave}
                onExit={exitEdit}
              />
            ) : (
              <MapFilters
                filters={filters}
                locale={locale}
                areas={areas}
                zoneOptions={zoneOptions}
                patch={(updates: MapFilterPatch) => patch(updates)}
                onSearch={search}
              />
            )}
            {editing && draftNotice !== null && (
              <DraftRestoreNotice
                kind={draftNotice.kind}
                onRestore={() => {
                  if (draftNotice.kind === 'restore') {
                    send({ type: 'RESTORE_DRAFT', zones: draftNotice.stored.draft });
                  }
                  setDraftNotice(null);
                }}
                onIgnore={() => {
                  // The autosave then clears the ignored draft (or keeps the edits made since).
                  setDraftNotice(null);
                }}
              />
            )}
            {!editing && !wide && can('atmZone.manage') && (
              <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
                {t('atm.map.panel.narrowNote')}
              </p>
            )}
            <div className="flex min-h-[420px] flex-1 gap-4">
              {panelBeside && (
                <aside
                  aria-label={t('atm.map.panel.toggle')}
                  className="w-[360px] shrink-0 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                >
                  {panel}
                </aside>
              )}
              <section className="min-w-0 flex-1">{canvas}</section>
            </div>
          </>
        )}
      </div>

      {!panelBeside && (
        <SideLayer
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
          title={t('atm.map.panel.toggle')}
          side={locale === 'ar' ? 'right' : 'left'}
          modal={false}
          dismissOnOutsideClick={false}
        >
          {panel}
        </SideLayer>
      )}

      {summary !== null && (
        <SaveSummaryDialog
          open={summaryOpen}
          summary={summary}
          overlaps={summaryOverlaps}
          saving={save.isPending}
          locale={locale}
          onBack={() => setSummaryOpen(false)}
          onConfirm={confirmSave}
        />
      )}
      <DeleteZoneDialog
        zone={
          deletingZone === undefined
            ? null
            : { name: deletingZone.name, count: editCounts.get(deletingZone.id) ?? 0 }
        }
        locale={locale}
        onBack={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting !== null) send({ type: 'DELETE_ZONE', zoneId: deleting });
          setDeleting(null);
        }}
      />
      <ConflictDialog
        open={editor.conflict}
        draftKept={draftKept}
        onClose={() => send({ type: 'CLOSE_CONFLICT' })}
        onReload={() => {
          send({ type: 'CLOSE_CONFLICT' });
          setConfirm({
            body: t('atm.map.discard.body'),
            go: () => {
              const branch = editor.branchId;
              if (branch === null) return;
              void fetchEditSet(branch).then(
                (set) => {
                  send({ type: 'DISCARD', set });
                  clearDraft(userId, branch);
                },
                (error: unknown) => toast.error(errorMessage(error, locale)),
              );
            },
          });
        }}
      />
      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        size="sm"
        title={t('atm.map.edit.discard')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              {t('atm.map.deleteZone.back')}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const go = confirm?.go;
                setConfirm(null);
                go?.();
              }}
            >
              {t('atm.map.edit.discard')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">{confirm?.body}</p>
      </Dialog>
      <Dialog
        open={guard.leaveOpen}
        onClose={guard.cancel}
        size="sm"
        title={t('atm.map.edit.exit')}
        footer={
          <>
            <Button variant="secondary" onClick={guard.cancel}>
              {t('atm.map.deleteZone.back')}
            </Button>
            <Button variant="danger" onClick={guard.confirm}>
              {t('atm.map.edit.exit')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('atm.map.leave.body')}</p>
      </Dialog>
    </PageContainer>
  );
};
