// While a paste run goes (several requests, `inPasteBatches` / `openInBatches`), closing or
// reloading the tab asks first — and a top-bar branch switch reloads it (BranchSwitcher). Leaving
// would drop the lines the run puts back into the boxes when it stops. Staying keeps the page: a
// run whose requests depend on the top-bar branch then sees the switch (`branchPin`) and stops
// before its next request, with its lines back and «تغيّر الفرع المختار أثناء الإرسال».
// The same `beforeunload` prompt the zone editor uses (useUnsavedGuard.ts), active only meanwhile.
import { useEffect } from 'react';

export const useRunUnloadGuard = (running: boolean): void => {
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
