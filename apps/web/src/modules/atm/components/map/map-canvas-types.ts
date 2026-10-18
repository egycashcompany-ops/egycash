// What a page hands the lazy map canvas, and what the canvas hands back (docs/12-planning/
// atm-map-zones.md §8.1, §8.4). Types only: a page imports these without pulling Leaflet into its
// own chunk — `MapCanvas.tsx` is the only file that imports `leaflet`.
import { type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { type AtmMapLatLng } from '@ecms/contracts';
import { type PixelPoint } from '../../lib/map-geometry';
import { type VertexRef } from '../../lib/zone-editor';

/** A zone as drawn: its ring, its colour, and the words on its label. */
export interface CanvasZone {
  id: string;
  name: string;
  color: string;
  /** Under 3:1 against the map → a dark casing under the outline (§8.8). */
  cased: boolean;
  points: readonly AtmMapLatLng[];
  /** «● name · count»'s count, already in words (DM-21). */
  countText: string;
}

/** One machine on the map. */
export interface CanvasDot {
  id: string;
  lat: number;
  lng: number;
  fill: string;
  ring: string;
  /** A hollow grey dot (no zone) has a thicker ring (§8.9). */
  ringWidth: number;
  /** Archived: drawn at 50 % (§8.9). */
  faded: boolean;
  /** Under review: a dashed amber «?» pin instead of a dot. */
  review: boolean;
}

/** The view, as the page's pure helpers need it (pixels for nudges and handles). */
export interface CanvasView {
  project: (p: AtmMapLatLng) => PixelPoint;
  unproject: (px: PixelPoint) => AtmMapLatLng;
  zoom: number;
}

/** The zone editor's view of the canvas (§8.6): handles, drawing, snapping. */
export interface CanvasEditor {
  mode: 'edit' | 'draw';
  selectedZoneId: string | null;
  selectedVertex: VertexRef | null;
  drawing: { points: readonly AtmMapLatLng[]; color: string } | null;
  snap: { on: boolean; px: number };
  onSelectZone: (zoneId: string | null) => void;
  onSelectVertex: (vertex: VertexRef | null) => void;
  onMoveVertex: (zoneId: string, index: number, point: AtmMapLatLng, unlink: boolean) => void;
  onInsertVertex: (zoneId: string, edgeIndex: number, point: AtmMapLatLng) => void;
  onEndGesture: () => void;
  onDeleteVertex: (vertex: VertexRef) => void;
  /** `pxFromLast`: the dot's on-screen distance from the previous one (the double-click rule). */
  onAddPoint: (point: AtmMapLatLng, pxFromLast: number | undefined) => void;
  onFinishDraw: () => void;
}

/** The temporary pin of a placement or a move (§8.8 `MovePinBar`). */
export interface CanvasPin {
  lat: number;
  lng: number;
  code: string;
  onMove: (point: AtmMapLatLng) => void;
}

/** A React overlay pinned to a point of the map (the popup, the vertex chip). */
export interface CanvasAnchor {
  key: string;
  lat: number;
  lng: number;
  /** `popup`: above the point (below it near the top edge); `chip`: just above it. */
  placement: 'popup' | 'chip';
  content: ReactNode;
}

/** Ask the canvas to move: fly to a point, or fit one zone. `seq` makes a repeat a new request. */
export type CanvasFocus =
  | { seq: number; kind: 'point'; lat: number; lng: number }
  | { seq: number; kind: 'zone'; zoneId: string };

export interface MapCanvasProps {
  ariaLabel: string;
  /** Edit mode: the amber border (`Edit.dc.html:180`) and no keyboard panning (§8.4). */
  editing: boolean;
  faded: boolean;
  zones: readonly CanvasZone[];
  showZones: boolean;
  /** Base fill: 0.25 on the map page, 0.12 on the unlocated screen (§8.3). */
  zoneFill: number;
  showLabels: boolean;
  zonesInteractive: boolean;
  /** Raised fill (0.35): the zone hovered in the list, or the open one. */
  highlightZoneId: string | null;
  onZoneClick?: (zoneId: string) => void;
  dots: readonly CanvasDot[];
  showDots: boolean;
  dotsInteractive: boolean;
  /** The 56 px grid below zoom 15 (DM-26); off in edit mode. */
  cluster: boolean;
  /** A cluster's colour when exactly one zone is filtered (§8.9); otherwise neutral ink. */
  clusterColor: string | null;
  onDotClick?: (machineId: string) => void;
  onMapClick?: () => void;
  editor?: CanvasEditor | null;
  /** «وضع على الخريطة»: a click places the machine. */
  onPlace?: ((point: AtmMapLatLng) => void) | null;
  pin?: CanvasPin | null;
  anchors?: readonly CanvasAnchor[];
  /** Fit the zones and dots whenever this changes (§8.4 default view). */
  fitKey: string;
  focus?: CanvasFocus | null;
  onView?: (view: CanvasView) => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  /** Overlays inside the map frame: hints, chips, the bottom bar, the legend. */
  children?: ReactNode;
}
