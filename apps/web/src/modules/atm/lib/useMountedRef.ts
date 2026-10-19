// Whether the component is still on screen, for an async loop that must stop when the page is left
// (§8.10's link-resolution loop).
//
// THE EFFECT SETS IT, NOT ONLY THE CLEANUP. React's StrictMode (main.tsx) mounts, unmounts and
// mounts again in development; a ref that only the cleanup writes is false from the first real
// render on, and a loop that checks it stops after its first call and never resets its spinner.
import { useEffect, useRef, type MutableRefObject } from 'react';

/** The effect behind `useMountedRef`: true on every mount, the second StrictMode one included. */
export const trackMounted = (ref: { current: boolean }) => (): (() => void) => {
  ref.current = true;
  return () => {
    ref.current = false;
  };
};

export const useMountedRef = (): MutableRefObject<boolean> => {
  const ref = useRef(true);
  useEffect(trackMounted(ref), []);
  return ref;
};
