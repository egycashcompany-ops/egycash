// While a paste run goes (several requests, `inPasteBatches` / `openInBatches`):
//   · the top-bar branch switch waits — it says so and changes nothing (`holdBranchSwitch`). A
//     switch writes the new branch and reloads; a reload the reader declined would leave the tab
//     on the new branch, unreloaded, with the run's lines waiting to be sent there;
//   · closing or reloading the tab asks first — leaving would drop the lines the run puts back
//     into the boxes when it stops. The same `beforeunload` prompt the zone editor uses
//     (useUnsavedGuard.ts), active only meanwhile.
// The runs' own branch pin (`branchPin`) stays as the backstop for a branch cleared without a
// switch (a stored branch retired meanwhile).
import { useEffect } from 'react';
import { holdBranchSwitch } from '../../../shared/lib/api-client';

export const useRunUnloadGuard = (running: boolean): void => {
  useEffect(() => {
    if (!running) return undefined;
    return holdBranchSwitch();
  }, [running]);

  useEffect(() => {
    if (!running) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      // Older browsers show the prompt only when `returnValue` is set.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [running]);
};
