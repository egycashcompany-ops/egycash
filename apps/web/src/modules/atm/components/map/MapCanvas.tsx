// The machine map's Leaflet canvas (docs/12-planning/atm-map-zones.md §8.4, DM-26…DM-28).
//
// THE ONLY FILE THAT IMPORTS LEAFLET. Both pages mount it with `React.lazy`, so Leaflet and its
// stylesheet arrive in a chunk of their own when a map is opened and never before (the
// `CatalogDialogs` precedent). Everything it decides that is not drawing — membership, snapping,
// clustering, label spots — is a pure `lib/` function it calls with pixels.
//
// ONE CANVAS FOR ZONES AND DOTS (DM-27). Zone fills, outlines, halos, casings and the machine dots
// all go to one `L.canvas()` renderer. Zones are added first and dots after, so the canvas's own
// hit-test (last drawn wins) gives a dot the click over the zone under it; after a zone rebuild the
// dots are brought back on top. Review pins, cluster bubbles, labels and edit handles are DOM
// `divIcon`s built by `lib/map-dom.ts` with `textContent` — never an HTML string with data in it —
// and the popup is a React overlay.
//
// BUILT ONCE. The `L.map` is created on mount and every changing value is read through a ref (the
// BranchMapPicker pattern), so a prop change updates layers in place and the tiles are never
// rebuilt. A zone ring that moves under a drag is `setLatLngs`-ed, not recreated.
//
// THE MAP STAYS LIGHT IN DARK MODE: nothing inside the frame carries a `dark:` class, and the
// overlays use fixed light colours. `dir="ltr"` on Leaflet's host, because `leaflet.css` has no RTL
// rules; every overlay sets its own direction.
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './atm-map.css';
import { type AtmMapLatLng, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { cn } from '../../../../shared/lib/cn';
import { formatNumber } from '../../../../shared/lib/format';
import { OSM_ATTRIBUTION, OSM_TILE_URL } from '../../../../shared/lib/osm-tiles';
import { clusterPoints, spiderfy, type ClusterInput } from '../../lib/map-cluster';
import {
  CLUSTER_INK,
  clusterElement,
  clusterSizePx,
  closeShapeElement,
  midpointHandleElement,
  reviewPinElement,
  tempPinElement,
  vertexHandleElement,
  VERTEX_SQUARE_CLASS,
  VERTEX_SQUARE_SELECTED_CLASS,
  zoneLabelElement,
  type ElementLike,
} from '../../lib/map-dom';
import {
  boxOf,
  coordKey,
  linkedVertices,
  midpoints,
  round6,
  snapCandidates,
  snapTarget,
  wouldCrossWhileDrawing,
  type PixelPoint,
  type SnapCandidates,
} from '../../lib/map-geometry';
import { placeLabel, resolveCollisions, type PlacedLabel } from '../../lib/map-labels';
import { machineCountText } from '../../lib/map-count-text';
import { ScaleBar } from './ScaleBar';
import { TileErrorBanner } from './TileErrorBanner';
import { type CanvasDot, type CanvasZone, type MapCanvasProps } from './map-canvas-types';

/** Where the map opens with nothing to show (`BranchMapPicker.tsx`). */
const CAIRO: L.LatLngExpression = [30.0444, 31.2357];
const CAIRO_ZOOM = 11;
/** «رقم الماكينة أو اسمها» flies here (§8.8 MapFilters). */
const POINT_ZOOM = 17;
/** More than this many tile errors within the window shows the banner (§8.4). */
const TILE_ERROR_LIMIT = 6;
const TILE_ERROR_WINDOW_MS = 10_000;
/** The first dot of a shape is 14 px across; a click within its radius closes the shape. */
const FIRST_DOT_PX = 7;
/** «إغلاق الشكل» shows while the cursor is this close to the first dot (`Edit.dc.html`). */
const CLOSE_HINT_PX = 14;
const LABEL_HEIGHT_PX = 22;
const MACHINE_DOT_RADIUS = 5;

const ll = (p: { lat: number; lng: number }): L.LatLngExpression => [p.lat, p.lng];
const toLatLng = (p: L.LatLng): AtmMapLatLng => round6({ lat: p.lat, lng: p.lng });
const asHtml = (el: ElementLike): HTMLElement => el as unknown as HTMLElement;

/** Hex to the outline's casing colour at 60 % (§8.8). */
const CASING = 'rgba(31,41,55,0.6)';

interface ZoneLayer {
  zone: CanvasZone;
  fill: L.Polygon;
  halo: L.Polyline | null;
  casing: L.Polyline | null;
}

interface HandleSet {
  zoneId: string;
  count: number;
  zoom: number;
  vertices: { marker: L.Marker; square: ElementLike }[];
  mids: L.Marker[];
}

/** A text's width in the label's own font, measured once per text. */
const measureCache = new Map<string, number>();
let measureContext: CanvasRenderingContext2D | null = null;
const textWidth = (text: string): number => {
  const cached = measureCache.get(text);
  if (cached !== undefined) return cached;
  if (measureContext === null) {
    measureContext = document.createElement('canvas').getContext('2d');
    if (measureContext !== null) {
      measureContext.font = `600 13px ${getComputedStyle(document.body).fontFamily}`;
    }
  }
  const width = measureContext?.measureText(text).width ?? text.length * 7.5;
  measureCache.set(text, width);
  return width;
};

export default function MapCanvas(props: MapCanvasProps): JSX.Element {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const dir: 'rtl' | 'ltr' = locale === 'ar' ? 'rtl' : 'ltr';

  const host = useRef<HTMLDivElement | null>(null);
  const map = useRef<L.Map | null>(null);
  const renderer = useRef<L.Canvas | null>(null);
  const current = useRef(props);
  current.current = props;
  const words = useRef({ t, locale, dir });
  words.current = { t, locale, dir };

  // Layers, kept so a prop change updates them in place.
  const zoneLayers = useRef<ZoneLayer[]>([]);
  const dotLayers = useRef(new Map<string, L.CircleMarker | L.Marker>());
  const clusterMarkers = useRef<L.Layer[]>([]);
  const spiderLayers = useRef<L.Layer[]>([]);
  const labelMarkers = useRef<L.Marker[]>([]);
  const handles = useRef<HandleSet | null>(null);
  const drawLayers = useRef<L.Layer[]>([]);
  const snapRing = useRef<L.CircleMarker | null>(null);
  const pinMarker = useRef<L.Marker | null>(null);
  const pinDragging = useRef(false);
  const cursor = useRef<{ latlng: AtmMapLatLng; px: PixelPoint } | null>(null);
  const spider = useRef<{ key: string; center: L.LatLng; ids: string[] } | null>(null);
  const tileErrors = useRef<number[]>([]);
  /** Each pinned overlay's measured height, so a tall popup is kept inside the frame. */
  const anchorHeights = useRef(new Map<string, number>());

  const [tick, setTick] = useState(0);
  const [hovered, setHovered] = useState<string | null>(null);
  const [tilesFailed, setTilesFailed] = useState(false);
  const [metersPerPixel, setMetersPerPixel] = useState(0);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // ── Helpers that read the live map ──────────────────────────────────────────────────────────
  const project = (p: { lat: number; lng: number }): PixelPoint => {
    const point = (map.current as L.Map).latLngToContainerPoint(ll(p));
    return { x: point.x, y: point.y };
  };

  const emitView = (): void => {
    const instance = map.current;
    if (instance === null) return;
    current.current.onView?.({
      project: (p) => {
        const point = instance.latLngToContainerPoint(ll(p));
        return { x: point.x, y: point.y };
      },
      unproject: (px) => toLatLng(instance.containerPointToLatLng(L.point(px.x, px.y))),
      zoom: instance.getZoom(),
    });
  };

  const measureScale = (): void => {
    const instance = map.current;
    if (instance === null) return;
    const box = instance.getSize();
    const y = box.y / 2;
    const a = instance.containerPointToLatLng(L.point(box.x / 2 - 50, y));
    const b = instance.containerPointToLatLng(L.point(box.x / 2 + 50, y));
    setMetersPerPixel(instance.distance(a, b) / 100);
    setSize({ width: box.x, height: box.y });
  };

  const fitAll = (): void => {
    const instance = map.current;
    if (instance === null) return;
    const { zones, dots, showZones, showDots } = current.current;
    const all: L.LatLngExpression[] = [];
    if (showZones) for (const zone of zones) for (const p of zone.points) all.push(ll(p));
    if (showDots) for (const dot of dots) all.push(ll(dot));
    if (all.length === 0) {
      instance.setView(CAIRO, CAIRO_ZOOM);
      return;
    }
    const bounds = L.latLngBounds(all);
    if (bounds.getNorthEast().equals(bounds.getSouthWest())) {
      instance.setView(bounds.getCenter(), 16);
      return;
    }
    instance.fitBounds(bounds, { padding: [32, 32], maxZoom: 16 });
  };

  // ── Build once ──────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (host.current === null || map.current !== null) return;
    const instance = L.map(host.current, { attributionControl: false, zoomControl: false }).setView(
      CAIRO,
      CAIRO_ZOOM,
    );
    renderer.current = L.canvas({ padding: 0.2 });
    renderer.current.addTo(instance);

    const tiles = L.tileLayer(OSM_TILE_URL, {
      maxZoom: 19,
      attribution: OSM_ATTRIBUTION,
      // Helmet sends `no-referrer`; OSM's policy expects a Referer (DM-28, GM-2). ATM map only.
      referrerPolicy: 'strict-origin-when-cross-origin',
    }).addTo(instance);
    tiles.on('tileerror', () => {
      const now = Date.now();
      tileErrors.current = [
        ...tileErrors.current.filter((at) => now - at < TILE_ERROR_WINDOW_MS),
        now,
      ];
      if (tileErrors.current.length > TILE_ERROR_LIMIT) setTilesFailed(true);
    });
    tiles.on('tileload', () => {
      tileErrors.current = [];
      setTilesFailed(false);
    });

    // Only «© OpenStreetMap» — Leaflet's own prefix is a link to Leaflet (DM-28). A licence
    // condition: never styled away.
    L.control.attribution({ prefix: false, position: 'bottomright' }).addTo(instance);
    const { t: tr } = words.current;
    L.control
      .zoom({
        position: 'topleft',
        zoomInTitle: tr('atm.map.controls.zoomIn'),
        zoomOutTitle: tr('atm.map.controls.zoomOut'),
      })
      .addTo(instance);
    // «عرض الكل», under the zoom buttons.
    const FitControl = L.Control.extend({
      onAdd: () => {
        const bar = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
        const button = L.DomUtil.create('a', '', bar) as HTMLAnchorElement;
        button.href = '#';
        button.setAttribute('role', 'button');
        button.title = words.current.t('atm.map.controls.fitAll');
        button.setAttribute('aria-label', words.current.t('atm.map.controls.fitAll'));
        button.textContent = '⤢';
        L.DomEvent.disableClickPropagation(bar);
        L.DomEvent.on(button, 'click', (event) => {
          L.DomEvent.preventDefault(event);
          fitAll();
        });
        return bar;
      },
    });
    new FitControl({ position: 'topleft' }).addTo(instance);

    let frame = 0;
    const onMove = (): void => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setTick((n) => n + 1);
      });
    };
    instance.on('move zoom', onMove);
    instance.on('moveend zoomend', () => {
      setTick((n) => n + 1);
      measureScale();
      emitView();
    });
    instance.on('zoomstart', () => {
      if (spider.current !== null) spider.current = null;
    });
    instance.on('click', (event: L.LeafletMouseEvent) => onMapClick(event));
    instance.on('dblclick', () => {
      const editor = current.current.editor;
      if (editor?.mode === 'draw') editor.onFinishDraw();
    });
    instance.on('mousemove', (event: L.LeafletMouseEvent) => onMapMove(event));
    instance.on('mouseout', () => {
      cursor.current = null;
      drawPreview();
    });

    const resize = new ResizeObserver(() => {
      instance.invalidateSize();
      measureScale();
      emitView();
    });
    resize.observe(host.current);

    map.current = instance;
    measureScale();
    emitView();
    return () => {
      resize.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
      instance.remove();
      map.current = null;
      renderer.current = null;
      zoneLayers.current = [];
      dotLayers.current = new Map();
      clusterMarkers.current = [];
      spiderLayers.current = [];
      labelMarkers.current = [];
      handles.current = null;
      drawLayers.current = [];
      snapRing.current = null;
      pinMarker.current = null;
    };
    // Built once — every changing value is read through `current`.
  }, []);

  // ── Map clicks and the drawing cursor ───────────────────────────────────────────────────────
  const drawCandidates = (): SnapCandidates => {
    const { zones, editor } = current.current;
    const drawing = editor?.drawing ?? null;
    const base: SnapCandidates =
      editor?.snap.on === true ? snapCandidates(zones, project) : { vertices: [], edges: [] };
    const first = drawing !== null && drawing.points.length >= 3 ? drawing.points[0] : undefined;
    return first === undefined ? base : { ...base, first: { px: project(first), latlng: first } };
  };

  const snapDraw = (
    px: PixelPoint,
    altKey: boolean,
  ): { point: AtmMapLatLng | null; first: boolean } => {
    const editor = current.current.editor;
    const candidates = drawCandidates();
    if (altKey || editor?.snap.on !== true) {
      // No snapping — but a click on the first dot still closes the shape.
      const first = candidates.first;
      const closes =
        first !== undefined &&
        first !== null &&
        Math.hypot(px.x - first.px.x, px.y - first.px.y) <= FIRST_DOT_PX;
      return { point: null, first: closes };
    }
    const hit = snapTarget(px, candidates, Math.max(editor.snap.px, FIRST_DOT_PX));
    if (hit === null) return { point: null, first: false };
    if (hit.kind === 'first') return { point: hit.latlng, first: true };
    // A vertex or an edge must be within the person's own threshold, not the first dot's.
    const exact = snapTarget(
      px,
      { vertices: candidates.vertices, edges: candidates.edges },
      editor.snap.px,
    );
    return { point: exact?.latlng ?? null, first: false };
  };

  const onMapClick = (event: L.LeafletMouseEvent): void => {
    const props_ = current.current;
    const editor = props_.editor;
    if (editor?.mode === 'draw') {
      const px = { x: event.containerPoint.x, y: event.containerPoint.y };
      const snapped = snapDraw(px, event.originalEvent.altKey);
      if (snapped.first) {
        editor.onFinishDraw();
        return;
      }
      const point = snapped.point ?? toLatLng(event.latlng);
      const points = editor.drawing?.points ?? [];
      const last = points[points.length - 1];
      const fromLast =
        last === undefined ? undefined : Math.hypot(project(last).x - px.x, project(last).y - px.y);
      if (wouldCrossWhileDrawing(points, point)) flashRefused(point);
      editor.onAddPoint(point, fromLast);
      return;
    }
    if (editor?.mode === 'edit') return;
    if (props_.onPlace) {
      props_.onPlace(toLatLng(event.latlng));
      return;
    }
    if (spider.current !== null) {
      spider.current = null;
      syncDots();
    }
    props_.onMapClick?.();
  };

  const onMapMove = (event: L.LeafletMouseEvent): void => {
    if (current.current.editor?.mode !== 'draw') return;
    const px = { x: event.containerPoint.x, y: event.containerPoint.y };
    const snapped = snapDraw(px, event.originalEvent.altKey);
    cursor.current = { latlng: snapped.point ?? toLatLng(event.latlng), px };
    showSnapRing(snapped.point !== null && !snapped.first ? snapped.point : null);
    drawPreview();
  };

  const flashRefused = (point: AtmMapLatLng): void => {
    const instance = map.current;
    if (instance === null || renderer.current === null) return;
    const flash = L.circleMarker(ll(point), {
      renderer: renderer.current,
      radius: 6,
      color: '#dc2626',
      weight: 2,
      fillColor: '#fecaca',
      fillOpacity: 1,
      interactive: false,
    }).addTo(instance);
    window.setTimeout(() => flash.remove(), 600);
  };

  const showSnapRing = (point: AtmMapLatLng | null): void => {
    const instance = map.current;
    if (instance === null || renderer.current === null) return;
    if (point === null) {
      snapRing.current?.remove();
      snapRing.current = null;
      return;
    }
    if (snapRing.current === null) {
      snapRing.current = L.circleMarker(ll(point), {
        renderer: renderer.current,
        radius: 13,
        color: '#0ea5e9',
        weight: 2.5,
        fillColor: '#0ea5e9',
        fillOpacity: 0.15,
        interactive: false,
      }).addTo(instance);
    } else {
      snapRing.current.setLatLng(ll(point));
    }
  };

  // ── Zones ───────────────────────────────────────────────────────────────────────────────────
  const zoneStyle = (zone: CanvasZone, raised: boolean, selected: boolean): L.PathOptions => ({
    color: zone.color,
    weight: selected ? 4 : 3,
    fillColor: zone.color,
    fillOpacity: raised ? Math.max(0.35, current.current.zoneFill) : current.current.zoneFill,
    lineJoin: 'round',
  });

  const syncZones = (): void => {
    const instance = map.current;
    const canvas = renderer.current;
    if (instance === null || canvas === null) return;
    const { zones, showZones, zonesInteractive, highlightZoneId, editor } = current.current;
    const shown = showZones ? zones : [];
    const selectedId = editor?.mode === 'edit' ? editor.selectedZoneId : null;
    const raisedId = (id: string): boolean =>
      id === highlightZoneId || id === hovered || id === selectedId;

    const existing = zoneLayers.current;
    const sameList =
      existing.length === shown.length &&
      existing.every(
        (layer, i) =>
          layer.zone.id === shown[i]?.id &&
          layer.zone.color === shown[i]?.color &&
          layer.zone.cased === shown[i]?.cased &&
          (layer.halo !== null) === (shown[i]?.id === selectedId) &&
          layer.fill.options.interactive === zonesInteractive,
      );

    if (sameList) {
      // A reshape, a rename or a hover: in place, so the draw order does not change.
      existing.forEach((layer, i) => {
        const zone = shown[i] as CanvasZone;
        if (layer.zone.points !== zone.points) {
          const ring = zone.points.map(ll);
          layer.fill.setLatLngs(ring);
          layer.halo?.setLatLngs([...ring, ring[0] as L.LatLngExpression]);
          layer.casing?.setLatLngs([...ring, ring[0] as L.LatLngExpression]);
        }
        layer.fill.setStyle(zoneStyle(zone, raisedId(zone.id), zone.id === selectedId));
        layer.zone = zone;
      });
      return;
    }

    for (const layer of existing) {
      layer.fill.remove();
      layer.halo?.remove();
      layer.casing?.remove();
    }
    zoneLayers.current = shown.map((zone) => {
      const ring = zone.points.map(ll);
      const closed = [...ring, ring[0] as L.LatLngExpression];
      const selected = zone.id === selectedId;
      // A white halo under the selected zone's outline, and a dark casing under a light colour.
      const halo = selected
        ? L.polyline(closed, {
            renderer: canvas,
            color: '#ffffff',
            weight: 8,
            interactive: false,
            lineJoin: 'round',
          }).addTo(instance)
        : null;
      const casing = zone.cased
        ? L.polyline(closed, {
            renderer: canvas,
            color: CASING,
            weight: selected ? 6 : 5,
            interactive: false,
            lineJoin: 'round',
          }).addTo(instance)
        : null;
      const fill = L.polygon(ring, {
        ...zoneStyle(zone, raisedId(zone.id), selected),
        renderer: canvas,
        interactive: zonesInteractive,
        bubblingMouseEvents: false,
      }).addTo(instance);
      if (zonesInteractive) {
        fill.on('click', () => {
          const live = current.current;
          if (live.editor?.mode === 'edit') live.editor.onSelectZone(zone.id);
          else live.onZoneClick?.(zone.id);
        });
        fill.on('mouseover', () => setHovered(zone.id));
        fill.on('mouseout', () => setHovered((id) => (id === zone.id ? null : id)));
      }
      return { zone, fill, halo, casing };
    });
    // The dots, the drawing and the snap ring go back on top of the rebuilt zones (DM-27).
    for (const layer of dotLayers.current.values()) {
      if (layer instanceof L.CircleMarker) layer.bringToFront();
    }
    for (const layer of [...spiderLayers.current, ...drawLayers.current]) {
      if (layer instanceof L.Path) layer.bringToFront();
    }
    snapRing.current?.bringToFront();
  };

  // ── Dots, clusters and stacks ───────────────────────────────────────────────────────────────
  const removeDot = (id: string): void => {
    dotLayers.current.get(id)?.remove();
    dotLayers.current.delete(id);
  };

  const putDot = (dot: CanvasDot, at: L.LatLngExpression, interactive: boolean): void => {
    const instance = map.current as L.Map;
    const canvas = renderer.current as L.Canvas;
    const existing = dotLayers.current.get(dot.id);
    if (dot.review) {
      if (existing instanceof L.Marker && existing.options.interactive === interactive) {
        existing.setLatLng(at);
        return;
      }
      if (existing !== undefined) removeDot(dot.id);
      const marker = L.marker(at, {
        icon: L.divIcon({
          className: '',
          html: asHtml(reviewPinElement(document, { faded: dot.faded })),
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        }),
        interactive,
        keyboard: false,
        bubblingMouseEvents: false,
      }).addTo(instance);
      if (interactive) marker.on('click', () => current.current.onDotClick?.(dot.id));
      dotLayers.current.set(dot.id, marker);
      return;
    }
    const style: L.CircleMarkerOptions = {
      radius: MACHINE_DOT_RADIUS,
      color: dot.ring,
      weight: dot.ringWidth,
      fillColor: dot.fill,
      fillOpacity: dot.faded ? 0.5 : 1,
      opacity: dot.faded ? 0.5 : 1,
    };
    if (existing instanceof L.CircleMarker && existing.options.interactive === interactive) {
      existing.setLatLng(at);
      existing.setStyle(style);
      return;
    }
    if (existing !== undefined) removeDot(dot.id);
    const circle = L.circleMarker(at, {
      ...style,
      renderer: canvas,
      interactive,
      bubblingMouseEvents: false,
    }).addTo(instance);
    if (interactive) circle.on('click', () => current.current.onDotClick?.(dot.id));
    dotLayers.current.set(dot.id, circle);
  };

  const syncDots = (): void => {
    const instance = map.current;
    const canvas = renderer.current;
    if (instance === null || canvas === null) return;
    const { dots, showDots, dotsInteractive, cluster, clusterColor } = current.current;
    for (const layer of [...clusterMarkers.current, ...spiderLayers.current]) layer.remove();
    clusterMarkers.current = [];
    spiderLayers.current = [];

    const shown = showDots ? dots : [];
    const wanted = new Set<string>();
    if (!cluster) {
      for (const dot of shown) {
        wanted.add(dot.id);
        putDot(dot, ll(dot), dotsInteractive);
      }
    } else {
      const zoom = instance.getZoom();
      const byId = new Map(shown.map((dot) => [dot.id, dot]));
      const inputs: ClusterInput[] = shown.map((dot) => {
        const world = instance.project(ll(dot), zoom);
        return { id: dot.id, lat: dot.lat, lng: dot.lng, px: { x: world.x, y: world.y } };
      });
      const { t: tr, locale: lc } = words.current;
      for (const group of clusterPoints(inputs, undefined, zoom)) {
        if (group.kind === 'single') {
          const dot = byId.get((group.members[0] as ClusterInput).id) as CanvasDot;
          wanted.add(dot.id);
          putDot(dot, ll(dot), dotsInteractive);
          continue;
        }
        const ids = group.members.map((m) => m.id);
        const key = ids.join('|');
        const center = instance.unproject(L.point(group.centerPx.x, group.centerPx.y), zoom);
        if (group.kind === 'stack' && spider.current?.key === key) {
          // Fanned out: each machine on its own leg, clickable.
          const centrePx = instance.latLngToContainerPoint(center);
          spiderfy({ x: centrePx.x, y: centrePx.y }, ids.length).forEach((px, i) => {
            const id = ids[i] as string;
            const dot = byId.get(id) as CanvasDot;
            const at = instance.containerPointToLatLng(L.point(px.x, px.y));
            spiderLayers.current.push(
              L.polyline([center, at], {
                renderer: canvas,
                color: '#334155',
                weight: 1.5,
                interactive: false,
              }).addTo(instance),
            );
            wanted.add(id);
            putDot(dot, at, true);
          });
          continue;
        }
        const count = ids.length;
        const marker = L.marker(center, {
          icon: L.divIcon({
            className: '',
            html: asHtml(
              clusterElement(document, {
                countText: formatNumber(count, lc),
                color: clusterColor ?? CLUSTER_INK,
                sizePx: clusterSizePx(count),
              }),
            ),
            iconSize: [clusterSizePx(count), clusterSizePx(count)],
            iconAnchor: [clusterSizePx(count) / 2, clusterSizePx(count) / 2],
          }),
          keyboard: dotsInteractive,
          interactive: dotsInteractive,
          bubblingMouseEvents: false,
        }).addTo(instance);
        const label = tr('atm.map.cluster.label', { countText: machineCountText(count, tr, lc) });
        marker.getElement()?.setAttribute('aria-label', label);
        marker.getElement()?.setAttribute('title', label);
        const open = (): void => {
          if (group.kind === 'stack') {
            spider.current = { key, center, ids };
            syncDots();
            return;
          }
          instance.fitBounds(L.latLngBounds(group.members.map((m) => ll(m))), {
            padding: [48, 48],
            maxZoom: 18,
          });
        };
        marker.on('click', open);
        marker.getElement()?.addEventListener('keydown', (event) => {
          if (event.code === 'Space') {
            event.preventDefault();
            open();
          }
        });
        clusterMarkers.current.push(marker);
      }
    }
    for (const id of [...dotLayers.current.keys()]) if (!wanted.has(id)) removeDot(id);
    for (const layer of dotLayers.current.values()) {
      if (layer instanceof L.CircleMarker) layer.bringToFront();
    }
    drawPreview();
  };

  // ── Labels (placed on moveend/zoomend, for the zones in view only — §8.4) ──────────────────
  const syncLabels = (): void => {
    const instance = map.current;
    if (instance === null) return;
    for (const marker of labelMarkers.current) marker.remove();
    labelMarkers.current = [];
    const { zones, showZones, showLabels, dots, showDots } = current.current;
    if (!showZones || !showLabels || zones.length === 0) return;
    const zoom = instance.getZoom();
    const bounds = instance.getBounds();
    const pins = showDots
      ? dots.filter((dot) => bounds.contains(ll(dot))).map((dot) => project(dot))
      : [];
    const { dir: d } = words.current;
    const placed: (PlacedLabel & { zone: CanvasZone })[] = [];
    for (const zone of zones) {
      const box = boxOf(zone.points);
      if (!bounds.intersects(L.latLngBounds([box.south, box.west], [box.north, box.east])))
        continue;
      const text = `${zone.name} · ${zone.countText}`;
      const width = Math.ceil(textWidth(text)) + 36;
      const at = placeLabel(
        zone.points.map(project),
        pins,
        { width, height: LABEL_HEIGHT_PX },
        zoom,
      );
      if (at === null) continue;
      placed.push({ zoneId: zone.id, x: at.x, y: at.y, width, height: LABEL_HEIGHT_PX, zone });
    }
    for (const label of resolveCollisions(placed)) {
      const zone = (label as PlacedLabel & { zone: CanvasZone }).zone;
      labelMarkers.current.push(
        L.marker(instance.containerPointToLatLng(L.point(label.x, label.y)), {
          icon: L.divIcon({
            className: 'flex items-center justify-center',
            html: asHtml(
              zoneLabelElement(document, {
                name: zone.name,
                countText: zone.countText,
                color: zone.color,
                dir: d,
              }),
            ),
            iconSize: [label.width, label.height],
            iconAnchor: [label.width / 2, label.height / 2],
          }),
          interactive: false,
          keyboard: false,
        }).addTo(instance),
      );
    }
  };

  // ── Edit handles (the selected zone only — `Edit.dc.html:213, 585`) ─────────────────────────
  const startDrag = (
    kind: 'vertex' | 'mid',
    zoneId: string,
    index: number,
    at: AtmMapLatLng,
    event: PointerEvent,
  ): void => {
    const instance = map.current;
    const editor = current.current.editor;
    if (instance === null || editor?.mode !== 'edit' || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    // `preventDefault` keeps the browser from focusing what was pressed; a vertex takes the focus
    // itself, so the arrow keys move it next (DM-41).
    if (kind === 'vertex' && event.currentTarget instanceof HTMLElement) {
      event.currentTarget.focus({ preventScroll: true });
    }
    const unlink = event.altKey;
    const zones = current.current.zones;
    // The zones that move with this point never snap onto themselves (the mockup's `snapPoint`).
    const moving = new Set(
      unlink ? [zoneId] : [zoneId, ...linkedVertices(zones, coordKey(at)).map((v) => v.zoneId)],
    );
    const candidates = snapCandidates(zones, project, moving);
    let target = index;
    let started = false;
    if (kind === 'mid') {
      editor.onInsertVertex(zoneId, index, at);
      target = index + 1;
      started = true;
    } else {
      editor.onSelectVertex({ zoneId, index });
    }
    instance.dragging.disable();
    let pending: AtmMapLatLng | null = null;
    let frame = 0;
    const flush = (): void => {
      frame = 0;
      if (pending === null) return;
      current.current.editor?.onMoveVertex(zoneId, target, pending, unlink);
      pending = null;
    };
    const move = (e: PointerEvent): void => {
      const point = instance.mouseEventToContainerPoint(e as unknown as MouseEvent);
      const px = { x: point.x, y: point.y };
      const snap = current.current.editor?.snap;
      const hit =
        snap !== undefined && snap.on && !e.altKey ? snapTarget(px, candidates, snap.px) : null;
      showSnapRing(hit?.latlng ?? null);
      pending = hit?.latlng ?? toLatLng(instance.containerPointToLatLng(point));
      started = true;
      if (frame === 0) frame = requestAnimationFrame(flush);
    };
    const up = (): void => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      if (frame !== 0) cancelAnimationFrame(frame);
      flush();
      showSnapRing(null);
      instance.dragging.enable();
      if (started) current.current.editor?.onEndGesture();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  };

  const clearHandles = (): void => {
    const set = handles.current;
    if (set === null) return;
    for (const v of set.vertices) v.marker.remove();
    for (const m of set.mids) m.remove();
    handles.current = null;
  };

  const syncHandles = (): void => {
    const instance = map.current;
    if (instance === null) return;
    const { editor, zones } = current.current;
    const zone =
      editor?.mode === 'edit' && editor.selectedZoneId !== null
        ? zones.find((z) => z.id === editor.selectedZoneId)
        : undefined;
    if (zone === undefined) {
      clearHandles();
      return;
    }
    const zoom = instance.getZoom();
    const mids = midpoints({ id: zone.id, points: zone.points }, project);
    const selected = editor?.selectedVertex ?? null;
    const set = handles.current;
    if (
      set !== null &&
      set.zoneId === zone.id &&
      set.count === zone.points.length &&
      set.zoom === zoom
    ) {
      // Same handles: move them, and mark the selected vertex in place (keeps the focus).
      zone.points.forEach((p, i) => {
        const v = set.vertices[i];
        if (v === undefined) return;
        v.marker.setLatLng(ll(p));
        v.square.className =
          selected?.zoneId === zone.id && selected.index === i
            ? VERTEX_SQUARE_SELECTED_CLASS
            : VERTEX_SQUARE_CLASS;
      });
      mids.forEach((mid, i) => {
        const marker = set.mids[i];
        if (marker === undefined) return;
        marker.setLatLng(ll(mid.latlng));
        marker.setOpacity(mid.hidden ? 0 : 1);
        const el = marker.getElement();
        if (el !== undefined) el.style.pointerEvents = mid.hidden ? 'none' : '';
      });
      return;
    }
    clearHandles();
    const { t: tr } = words.current;
    const next: HandleSet = {
      zoneId: zone.id,
      count: zone.points.length,
      zoom,
      vertices: [],
      mids: [],
    };
    mids.forEach((mid) => {
      const el = midpointHandleElement(document);
      const marker = L.marker(ll(mid.latlng), {
        icon: L.divIcon({
          className: '',
          html: asHtml(el),
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        }),
        keyboard: false,
        interactive: true,
        opacity: mid.hidden ? 0 : 1,
      }).addTo(instance);
      const element = marker.getElement();
      if (element !== undefined) {
        element.setAttribute('aria-label', tr('atm.map.vertex.midpoint'));
        element.title = tr('atm.map.vertex.midpoint');
        if (mid.hidden) element.style.pointerEvents = 'none';
        L.DomEvent.disableClickPropagation(element);
        element.addEventListener('pointerdown', (event) => {
          const live = current.current.zones.find((z) => z.id === zone.id);
          const now =
            live === undefined
              ? undefined
              : midpoints({ id: live.id, points: live.points }, project)[mid.edgeIndex];
          if (now !== undefined) startDrag('mid', zone.id, mid.edgeIndex, now.latlng, event);
        });
      }
      next.mids.push(marker);
    });
    zone.points.forEach((p, index) => {
      const isSelected = selected?.zoneId === zone.id && selected.index === index;
      const { hit, square } = vertexHandleElement(document, { selected: isSelected });
      const marker = L.marker(ll(p), {
        icon: L.divIcon({
          className: '',
          html: asHtml(hit),
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        }),
        keyboard: true,
        interactive: true,
        zIndexOffset: 1000,
      }).addTo(instance);
      const element = marker.getElement();
      if (element !== undefined) {
        element.setAttribute(
          'aria-label',
          tr('atm.map.vertex.label', {
            n: formatNumber(index + 1, words.current.locale),
            zone: zone.name,
          }),
        );
        L.DomEvent.disableClickPropagation(element);
        element.addEventListener('pointerdown', (event) => {
          const live = current.current.zones.find((z) => z.id === zone.id);
          const now = live?.points[index];
          if (now !== undefined) startDrag('vertex', zone.id, index, now, event);
        });
        element.addEventListener('dblclick', (event) => {
          event.preventDefault();
          event.stopPropagation();
          current.current.editor?.onDeleteVertex({ zoneId: zone.id, index });
        });
        element.addEventListener('focus', () => {
          const sel = current.current.editor?.selectedVertex;
          if (sel?.zoneId !== zone.id || sel.index !== index) {
            current.current.editor?.onSelectVertex({ zoneId: zone.id, index });
          }
        });
      }
      next.vertices.push({ marker, square });
    });
    handles.current = next;
  };

  // ── The shape being drawn ───────────────────────────────────────────────────────────────────
  const drawPreview = (): void => {
    const instance = map.current;
    const canvas = renderer.current;
    if (instance === null || canvas === null) return;
    for (const layer of drawLayers.current) layer.remove();
    drawLayers.current = [];
    const editor = current.current.editor;
    const drawing = editor?.mode === 'draw' ? editor.drawing : null;
    if (drawing === null || drawing === undefined) return;
    const points = drawing.points.map(ll);
    const color = drawing.color;
    const add = (layer: L.Layer): void => {
      drawLayers.current.push(layer.addTo(instance));
    };
    if (points.length >= 3) {
      add(
        L.polygon(points, {
          renderer: canvas,
          stroke: false,
          fillColor: color,
          fillOpacity: 0.15,
          interactive: false,
        }),
      );
    }
    if (points.length >= 2) {
      add(
        L.polyline(points, {
          renderer: canvas,
          color,
          weight: 3,
          interactive: false,
          lineJoin: 'round',
        }),
      );
    }
    const last = drawing.points[drawing.points.length - 1];
    const hover = cursor.current;
    if (last !== undefined && hover !== null) {
      add(
        L.polyline([ll(last), ll(hover.latlng)], {
          renderer: canvas,
          color,
          weight: 2,
          dashArray: '7 6',
          interactive: false,
        }),
      );
    }
    const first = drawing.points[0];
    const nearFirst =
      first !== undefined &&
      drawing.points.length >= 3 &&
      hover !== null &&
      Math.hypot(project(first).x - hover.px.x, project(first).y - hover.px.y) < CLOSE_HINT_PX;
    drawing.points.forEach((p, i) => {
      if (i === 0 && nearFirst) {
        add(
          L.circleMarker(ll(p), {
            renderer: canvas,
            radius: 12,
            stroke: false,
            fillColor: '#4f46e5',
            fillOpacity: 0.3,
            interactive: false,
          }),
        );
      }
      add(
        L.circleMarker(ll(p), {
          renderer: canvas,
          radius: i === 0 ? 7 : 5,
          color,
          weight: 3,
          fillColor: '#ffffff',
          fillOpacity: 1,
          interactive: false,
        }),
      );
    });
    if (nearFirst && first !== undefined) {
      const { t: tr, dir: d } = words.current;
      add(
        L.marker(ll(first), {
          icon: L.divIcon({
            className: 'flex items-end justify-center',
            html: asHtml(closeShapeElement(document, tr('atm.map.draw.closeShape'), d)),
            iconSize: [120, 22],
            iconAnchor: [60, 34],
          }),
          interactive: false,
          keyboard: false,
        }),
      );
    }
  };

  // ── The temporary pin (MovePinBar) ──────────────────────────────────────────────────────────
  const syncPin = (): void => {
    const instance = map.current;
    if (instance === null) return;
    const pin = current.current.pin ?? null;
    const marker = pinMarker.current;
    if (pin === null) {
      marker?.remove();
      pinMarker.current = null;
      return;
    }
    const code = (marker as (L.Marker & { ecmsCode?: string }) | null)?.ecmsCode;
    if (marker !== null && code === pin.code) {
      if (!pinDragging.current) {
        const at = marker.getLatLng();
        if (at.lat !== pin.lat || at.lng !== pin.lng) marker.setLatLng(ll(pin));
      }
      return;
    }
    marker?.remove();
    const next = L.marker(ll(pin), {
      icon: L.divIcon({
        className: '',
        html: asHtml(tempPinElement(document, pin.code)),
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      }),
      draggable: true,
      keyboard: true,
      autoPan: true,
      zIndexOffset: 2000,
    }).addTo(instance) as L.Marker & { ecmsCode?: string };
    next.ecmsCode = pin.code;
    let frame = 0;
    next.on('dragstart', () => {
      pinDragging.current = true;
    });
    next.on('drag', () => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        current.current.pin?.onMove(toLatLng(next.getLatLng()));
      });
    });
    next.on('dragend', () => {
      pinDragging.current = false;
      if (frame !== 0) cancelAnimationFrame(frame);
      frame = 0;
      current.current.pin?.onMove(toLatLng(next.getLatLng()));
    });
    const element = next.getElement();
    if (element !== undefined) {
      element.setAttribute(
        'aria-label',
        words.current.t('atm.map.move.markerAria', { code: pin.code }),
      );
      // DM-41: the arrow keys move the focused pin 1 px, or 10 px with Shift.
      element.addEventListener('keydown', (event) => {
        const step = event.shiftKey ? 10 : 1;
        const delta: Record<string, [number, number]> = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, -step],
          ArrowDown: [0, step],
        };
        const d = delta[event.code];
        if (d === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        const px = instance.latLngToContainerPoint(next.getLatLng());
        const moved = instance.containerPointToLatLng(L.point(px.x + d[0], px.y + d[1]));
        next.setLatLng(moved);
        current.current.pin?.onMove(toLatLng(moved));
      });
    }
    pinMarker.current = next;
  };

  // ── Prop → layer effects ────────────────────────────────────────────────────────────────────
  const editorMode = props.editor?.mode ?? null;
  useEffect(() => {
    const instance = map.current;
    if (instance === null) return;
    // Leaflet pans on the arrow keys once the map has focus; in edit mode the arrows move a vertex.
    if (props.editing) instance.keyboard.disable();
    else instance.keyboard.enable();
    if (editorMode === 'draw') instance.doubleClickZoom.disable();
    else instance.doubleClickZoom.enable();
    instance.getContainer().style.cursor =
      editorMode === 'draw' || props.onPlace ? 'crosshair' : '';
    if (editorMode !== 'draw') {
      cursor.current = null;
      showSnapRing(null);
    }
  }, [props.editing, editorMode, props.onPlace]);

  useEffect(() => {
    syncZones();
  }, [
    props.zones,
    props.showZones,
    props.zoneFill,
    props.zonesInteractive,
    props.highlightZoneId,
    hovered,
    props.editor?.selectedZoneId,
    editorMode,
  ]);

  useEffect(() => {
    syncDots();
  }, [props.dots, props.showDots, props.dotsInteractive, props.cluster, props.clusterColor]);

  // Regroup the clusters when the zoom settles (world pixels change only with the zoom).
  const zoom = map.current?.getZoom() ?? null;
  useEffect(() => {
    spider.current = null;
    syncDots();
  }, [zoom]);

  useEffect(() => {
    syncHandles();
  }, [props.zones, props.editor?.selectedZoneId, props.editor?.selectedVertex, editorMode, zoom]);

  useEffect(() => {
    drawPreview();
  }, [props.editor?.drawing, editorMode, props.zones]);

  useEffect(() => {
    syncPin();
  }, [props.pin]);

  // Labels follow the view: placed when it settles (`moveend`/`zoomend` bump `tick`).
  useEffect(() => {
    const handle = window.setTimeout(syncLabels, 120);
    return () => window.clearTimeout(handle);
  }, [props.zones, props.showLabels, props.showZones, props.dots, props.showDots, tick]);

  useEffect(() => {
    fitAll();
  }, [props.fitKey]);

  const focusSeq = props.focus?.seq ?? null;
  useEffect(() => {
    const instance = map.current;
    const focus = current.current.focus;
    if (instance === null || focus === null || focus === undefined) return;
    if (focus.kind === 'point') {
      instance.setView([focus.lat, focus.lng], Math.max(POINT_ZOOM, instance.getZoom()));
      return;
    }
    const zone = current.current.zones.find((z) => z.id === focus.zoneId);
    if (zone === undefined || zone.points.length === 0) return;
    instance.fitBounds(L.latLngBounds(zone.points.map(ll)), { padding: [40, 40], maxZoom: 17 });
  }, [focusSeq]);

  // ── Overlays pinned to the map (the popup, the vertex chip) ─────────────────────────────────
  const anchored = (props.anchors ?? []).map((anchor) => {
    if (map.current === null) return null;
    const point = project(anchor);
    const width = size.width;
    if (anchor.placement === 'chip') {
      return (
        <div
          key={anchor.key}
          dir={dir}
          className="absolute z-[1100] -translate-x-1/2 -translate-y-full"
          style={{ left: point.x, top: point.y - 16 }}
        >
          {anchor.content}
        </div>
      );
    }
    // Beside the point, as in the mockup — on the reading-start side when it fits — and moved up
    // or down so the whole popup stays inside the frame, whatever its height.
    const popupWidth = 280;
    const gap = 18;
    const height = anchorHeights.current.get(anchor.key) ?? 300;
    const fitsLeft = point.x - gap - popupWidth >= 8;
    const fitsRight = point.x + gap + popupWidth <= width - 8;
    const onLeft = dir === 'rtl' ? fitsLeft || !fitsRight : !fitsRight && fitsLeft;
    const left = onLeft ? Math.max(8, point.x - gap - popupWidth) : point.x + gap;
    const top = Math.min(Math.max(point.y - height / 2, 8), Math.max(8, size.height - height - 8));
    return (
      <div
        key={anchor.key}
        dir={dir}
        ref={(el) => {
          if (el === null) return;
          const measured = el.offsetHeight;
          if (measured > 0 && measured !== anchorHeights.current.get(anchor.key)) {
            anchorHeights.current.set(anchor.key, measured);
            requestAnimationFrame(() => setTick((n) => n + 1));
          }
        }}
        className="absolute z-[1100]"
        style={{ left, top }}
      >
        {anchor.content}
      </div>
    );
  });

  return (
    <div
      onKeyDown={props.onKeyDown}
      className={cn(
        'relative isolate h-full overflow-hidden rounded-2xl bg-[#f2efe9]',
        props.editing ? 'border-2 border-amber-300' : 'border border-slate-200',
        props.faded && 'atm-map-faded',
      )}
    >
      <div
        ref={host}
        dir="ltr"
        role="application"
        aria-label={props.ariaLabel}
        className="h-full w-full bg-[#f2efe9]"
      />
      {tilesFailed && <TileErrorBanner dir={dir} />}
      {metersPerPixel > 0 && <ScaleBar metersPerPixel={metersPerPixel} locale={locale} />}
      {anchored}
      {props.children}
    </div>
  );
}
