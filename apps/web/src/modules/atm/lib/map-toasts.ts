// The map's result toasts as a short title and a sentence (docs/12-planning/atm-map-zones.md §8.10).
// The shared Toaster shows a title on ONE line and cuts the rest; only the description wraps. A
// result sentence put in the title loses exactly its last figures — «وبقي n بلا موقع», the zone,
// the audit notice — so each sentence goes in the description, under a title short enough to fit.
import { type AtmMapSyncResultDto, type Locale } from '@ecms/contracts';
import { formatNumber } from '../../../shared/lib/format';
import { type Translate } from './map-count-text';
import { NOTICE_KEYS } from './zone-editor';

export interface ToastWords {
  title: string;
  description?: string;
}

/** «مزامنة المواقع من سجل الماكينات» over its three counts (§6.4 `processed`). */
export const syncDoneToast = (
  result: Pick<AtmMapSyncResultDto, 'located' | 'review' | 'unlocated'>,
  t: Translate,
  locale: Locale,
): ToastWords => ({
  title: t('atm.map.sync.title'),
  description: t('atm.map.sync.done', {
    located: formatNumber(result.located, locale),
    review: formatNumber(result.review, locale),
    unlocated: formatNumber(result.unlocated, locale),
  }),
});

/** A pin placed, moved or approved: the machine, its zone and the audit notice. */
export const locatedToast = (code: string, zone: string, t: Translate): ToastWords => ({
  title: t('atm.map.move.doneTitle'),
  description: t('atm.map.move.done', { code, zone }),
});

/** The editor's long notices get a title of their own; a short one is its own title. */
const NOTICE_TITLES: Record<string, string> = {
  [NOTICE_KEYS.added]: 'atm.map.draw.addedTitle',
  [NOTICE_KEYS.tooSmall]: 'atm.map.edit.notApplied',
  [NOTICE_KEYS.geometry]: 'atm.map.edit.notApplied',
};

export const noticeToast = (key: string, t: Translate): ToastWords => {
  const title = NOTICE_TITLES[key];
  return title === undefined ? { title: t(key) } : { title: t(title), description: t(key) };
};
