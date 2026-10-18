// Whether the viewport is at least this wide — for the two widths the map changes at (DM-40):
// editing is offered from 768 px, and the panel sits beside the map from 1024 px (below that it
// moves into a `SideLayer`). Without a window (the suite renders on the server) it answers yes.
import { useEffect, useState } from 'react';

const matches = (query: string): boolean =>
  typeof window === 'undefined' || typeof window.matchMedia !== 'function'
    ? true
    : window.matchMedia(query).matches;

export const useMinWidth = (px: number): boolean => {
  const query = `(min-width: ${String(px)}px)`;
  const [wide, setWide] = useState(() => matches(query));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(query);
    const update = (): void => setWide(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return wide;
};
