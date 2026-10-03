// Saying WHY a keystroke or a paste was refused — «يظهر رساله فيها السبب».
//
// Inside a `Field` the reason is written under the control, in the place an error goes, and the
// control's border turns red; the two clear as soon as an accepted value arrives (or after a few
// seconds). Outside a `Field` — a filter bar has no row under its controls — the browser's own
// bubble shows it beside the box, so no layout around the control has to change to make room.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

type Report = (message: string | null) => void;

const FieldFeedback = createContext<Report | null>(null);
export const FieldFeedbackProvider = FieldFeedback.Provider;

/** How long a refusal stays on screen when nothing else clears it. */
const SHOWN_MS = 5000;

export const useInputFeedback = (): {
  /** The control should read as refused right now — its border goes red. */
  flash: boolean;
  show: (element: HTMLInputElement | HTMLTextAreaElement | null, message: string) => void;
  clear: (element: HTMLInputElement | HTMLTextAreaElement | null) => void;
} => {
  const report = useContext(FieldFeedback);
  const [flash, setFlash] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownOn = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  const clear = useCallback(
    (element: HTMLInputElement | HTMLTextAreaElement | null): void => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      setFlash(false);
      report?.(null);
      (element ?? shownOn.current)?.setCustomValidity('');
      shownOn.current = null;
    },
    [report],
  );

  const show = useCallback(
    (element: HTMLInputElement | HTMLTextAreaElement | null, message: string): void => {
      setFlash(true);
      shownOn.current = element;
      if (report !== null) report(message);
      else if (element !== null) {
        element.setCustomValidity(message);
        element.reportValidity();
      }
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => clear(element), SHOWN_MS);
    },
    [report, clear],
  );

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  return { flash, show, clear };
};
