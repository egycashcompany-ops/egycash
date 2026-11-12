// «اليوم التشغيلي … هو هيجيب بتاعت اليوم»: the day board shows today and nothing else — so a board
// left open on the desk overnight has to move to the new day by itself, not keep showing yesterday
// as if it were today.
import { useEffect, useState } from 'react';
import { cairoToday, msUntilNextCairoDay } from './shipment-history';

/**
 * Today in Cairo, kept current while the screen stays open.
 *
 * The day is read on EVERY render, so any render after midnight — a refetch, a filter typed — is
 * already on the new day. Two things make sure a render happens even on an idle screen, and both
 * are cheap: one timer set for the next Cairo midnight (re-armed for the day after once it fires),
 * and a look when the tab comes back into view — a laptop that slept through midnight runs that
 * timer late, or not at all. Neither re-renders anything unless the day has actually changed.
 */
export const useCairoToday = (): string => {
  const today = cairoToday();
  const [, setSeen] = useState(today);

  useEffect(() => {
    const look = (): void => setSeen(cairoToday());
    // A second past midnight, so the timer can never fire on the old day's last instant.
    const timer = window.setTimeout(look, msUntilNextCairoDay() + 1000);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') look();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [today]);

  return today;
};
