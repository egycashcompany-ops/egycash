// The Google Maps link handed to a person for a stored point (ATM map spec §8.5, promoted from
// `operations/lib/maps-link.ts`, which keeps exporting it as `mapsUrl`).
//
// `?q=` rather than a directions URL: it answers "where is this", and the reader's own app takes it
// from there. Generated from the point every time, so it cannot go stale the way a stored link can.

export const googleMapsUrl = ({ lat, lng }: { lat: number; lng: number }): string =>
  `https://www.google.com/maps?q=${String(lat)},${String(lng)}`;
