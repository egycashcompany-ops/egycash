// The Arabic scale bar (docs/12-planning/atm-map-zones.md §8.4, DM-28): Leaflet's own scale control
// speaks English only. The bar shows the longest round distance — 1, 2 or 5 × 10ⁿ metres — that fits
// in 72 px at the map's centre, as «{{n}} م» or, from a kilometre, «{{n}} كم».

export interface ScaleBar {
  meters: number;
  /** The bar's on-screen length for that distance. */
  px: number;
  label: { key: 'atm.map.scale.m' | 'atm.map.scale.km'; n: number };
}

/** The bar for this many metres per pixel; null when the map has no usable scale yet. */
export const scaleFor = (metersPerPixel: number, maxPx = 72): ScaleBar | null => {
  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0 || maxPx <= 0) return null;
  const longest = metersPerPixel * maxPx;
  const power = 10 ** Math.floor(Math.log10(longest));
  const step = [5, 2, 1].find((m) => m * power <= longest) ?? 1;
  const meters = step * power;
  return {
    meters,
    px: meters / metersPerPixel,
    label:
      meters >= 1000
        ? { key: 'atm.map.scale.km', n: meters / 1000 }
        : { key: 'atm.map.scale.m', n: meters },
  };
};
