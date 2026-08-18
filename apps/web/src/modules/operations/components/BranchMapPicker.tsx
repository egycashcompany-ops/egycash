// Picking a branch's location by clicking it.
//
// LAZY ON PURPOSE. This module pulls in Leaflet and its stylesheet, and it is opened by one person
// filling in reference data — the rest of the console must not carry the bytes. `CatalogDialogs`
// mounts it through `React.lazy`, so the chunk arrives when the map is asked for and never before.
//
// TILES COME FROM OPENSTREETMAP, which is why `app.ts` widens `img-src` to their host: a tile is an
// <img> and the default `'self'` blocks it. Attribution is rendered by the tile layer below and is
// a LICENCE CONDITION of using those tiles, not decoration — it does not get styled away.
//
// The marker is a `divIcon`, i.e. an HTML element, not Leaflet's default PNG. Its default icon is
// resolved from a runtime URL that bundlers famously break; a div renders identically, themes with
// the rest of the app, and adds no image asset to explain.
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useT } from '../../../platform/localization/useT';
import { type MapsCoordinates } from '../lib/maps-link';

/** Where the map opens when the branch has no point yet. Most branches are in greater Cairo. */
const DEFAULT_CENTRE: MapsCoordinates = { lat: 30.0444, lng: 31.2357 };
const DEFAULT_ZOOM = 11;
/** Zoom used when the branch already HAS a point — close enough to see which building. */
const POINT_ZOOM = 17;

/**
 * Six decimals is about 11cm. Leaflet hands back fifteen, which is a false precision that then
 * gets stored, shown to a captain and compared in a diff forever.
 */
const round = ({ lat, lng }: MapsCoordinates): MapsCoordinates => ({
  lat: Number(lat.toFixed(6)),
  lng: Number(lng.toFixed(6)),
});

const pin = L.divIcon({
  className: '',
  html: '<span class="block h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-brand-500 shadow"></span>',
  iconSize: [0, 0],
});

export const BranchMapPicker = ({
  value,
  onChange,
}: {
  value: MapsCoordinates | null;
  onChange: (coordinates: MapsCoordinates) => void;
}): JSX.Element => {
  const t = useT();
  const host = useRef<HTMLDivElement | null>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  // The handler is read from a ref so the map is built ONCE. Rebuilding it on every render would
  // tear down the tiles the user is looking at, and re-fetch them.
  const emit = useRef(onChange);
  emit.current = onChange;
  // Where the map OPENS, captured on first render. The live `value` is followed by the second
  // effect, which moves the pin; if this read the live one the map would rebuild on every click.
  const openedAt = useRef(value);

  useEffect(() => {
    if (host.current === null || map.current !== null) return;
    const start = openedAt.current;
    const instance = L.map(host.current, { attributionControl: true }).setView(
      [start?.lat ?? DEFAULT_CENTRE.lat, start?.lng ?? DEFAULT_CENTRE.lng],
      start === null ? DEFAULT_ZOOM : POINT_ZOOM,
    );
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(instance);
    instance.on('click', (event: L.LeafletMouseEvent) => {
      emit.current(round({ lat: event.latlng.lat, lng: event.latlng.lng }));
    });
    map.current = instance;
    return () => {
      instance.remove();
      map.current = null;
      marker.current = null;
    };
    // Built once — every changing value it needs is read through a ref.
  }, []);

  // Follow the point wherever it came from — a click here, a pasted link in the field above, or
  // the branch being loaded for edit. One pin, one source of truth, held by the dialog.
  useEffect(() => {
    const instance = map.current;
    if (instance === null) return;
    if (value === null) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    const at: L.LatLngExpression = [value.lat, value.lng];
    if (marker.current === null) {
      const placed = L.marker(at, { icon: pin, draggable: true }).addTo(instance);
      placed.on('dragend', () => {
        const moved = placed.getLatLng();
        emit.current(round({ lat: moved.lat, lng: moved.lng }));
      });
      marker.current = placed;
    } else {
      marker.current.setLatLng(at);
    }
    instance.panTo(at);
  }, [value]);

  return (
    <div className="space-y-1">
      <div
        ref={host}
        role="application"
        aria-label={t('operations.catalogs.branch.maps.pick')}
        className="h-64 w-full overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700"
      />
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {t('operations.catalogs.branch.maps.pickHint')}
      </p>
    </div>
  );
};

export default BranchMapPicker;
