// «ماكينات بدون موقع» as plain data (docs/12-planning/atm-map-zones.md §8.5, §8.8, §8.10): the reason
// chips, what the paste box says about a parse, the words for a link that did not convert, and when
// the link-resolution loop goes on.
//
// THE LOOP IS ONE PASS (DM-46). The server opens each short link once; the browser only keeps
// calling while the server says there is more and nothing stopped it. A run that got no answer
// from Google stops — `unreachable` or `rateLimited` — and leaves its links pending, and another
// person's run (`busy`) is never raced. There is no retry of failed links and no stop button.
import {
  type AtmMapLinkFailure,
  type AtmMapLinkResolveResultDto,
  type AtmMapParseResultDto,
  type AtmMapPointDto,
  type AtmMapUnlocatedReasonDto,
} from '@ecms/contracts';

/**
 * A chip: a pin under review, a placed pin outside Egypt (DM-35: it warns, never blocks — so it is
 * listed here, where somebody who can locate will see it), or why a machine has no point.
 */
export type UnlocatedChip = 'review' | 'outsideEgypt' | AtmMapUnlocatedReasonDto;

/** The chips' order on screen (§8.8 `ReasonChips`). */
export const UNLOCATED_CHIP_ORDER: readonly UnlocatedChip[] = [
  'review',
  'outsideEgypt',
  'shortLink',
  'shortLinkFailed',
  'noCoordinates',
  'shortPlusCodeNoReference',
  'invalidCoordinates',
  'unreadable',
  'conflictingEntries',
  'noEntry',
  'none',
  'notSynced',
];

export const chipLabelKey = (chip: UnlocatedChip): string => `atm.map.reason.${chip}`;

/** The chip a row belongs to, or null for a machine that is located and needs nothing. */
export const chipOf = (point: AtmMapPointDto): UnlocatedChip | null => {
  if (point.state === 'review') return 'review';
  if (point.state === 'unlocated') return point.reason ?? 'none';
  if (point.warnings.includes('outsideEgypt')) return 'outsideEgypt';
  return null;
};

/** One count per chip, in screen order; a chip with nothing in it is not shown. */
export const reasonChipCounts = (
  points: readonly AtmMapPointDto[],
): { chip: UnlocatedChip; count: number }[] => {
  const counts = new Map<UnlocatedChip, number>();
  for (const point of points) {
    const chip = chipOf(point);
    if (chip !== null) counts.set(chip, (counts.get(chip) ?? 0) + 1);
  }
  return UNLOCATED_CHIP_ORDER.filter((chip) => (counts.get(chip) ?? 0) > 0).map((chip) => ({
    chip,
    count: counts.get(chip) ?? 0,
  }));
};

/**
 * A row's header pressed: it opens (or the open one closes), and the map's temporary state —
 * placing mode, a dragged or previewed pin — ends. That state belongs to the row that started it
 * (the mockup's row `pick`: `mm.placing = false; mm.pin = …`), so a click on the map after another
 * row was opened never places the previous machine.
 */
export const rowToggle = (
  openId: string | null,
  machineId: string,
): { openId: string | null; placing: null; moving: null } => ({
  openId: openId === machineId ? null : machineId,
  placing: null,
  moving: null,
});

export type FeedbackTone = 'success' | 'warning' | 'error';

/**
 * The inline message under the paste box. A point the text gives only roughly — a map centre, a
 * short Plus Code, two points in one link, two places far apart — says so before anything else;
 * a point outside Egypt is a warning, never a refusal (DM-35).
 */
export const parseFeedback = (
  result: AtmMapParseResultDto,
): { key: string; tone: FeedbackTone } => {
  if (!result.ok) return { key: `atm.map.parse.${result.reason}`, tone: 'error' };
  if (result.kind === 'viewport' || result.warnings.includes('viewportOnly')) {
    return { key: 'atm.map.parse.viewportReview', tone: 'warning' };
  }
  if (result.kind === 'shortPlusCode') {
    return { key: 'atm.map.parse.shortPlusCodeReview', tone: 'warning' };
  }
  if (result.warnings.includes('ambiguousUrl')) {
    return { key: 'atm.map.unlocated.ambiguousNote', tone: 'warning' };
  }
  if (result.warnings.includes('sourcesDisagree')) {
    return { key: 'atm.map.unlocated.disagreeNote', tone: 'warning' };
  }
  if (result.warnings.includes('outsideEgypt')) {
    return { key: 'atm.map.parse.outsideEgypt', tone: 'warning' };
  }
  return { key: 'atm.map.parse.ok', tone: 'success' };
};

export const linkFailureKey = (failure: AtmMapLinkFailure): string =>
  `atm.map.linkFailure.${failure}`;

/**
 * Call again? Only while links remain, this call attempted some, nobody else holds the run, and the
 * only stop was this call's own time budget (§8.10).
 */
export const resolveLoopShouldContinue = (result: AtmMapLinkResolveResultDto): boolean =>
  result.remaining > 0 &&
  result.attempted > 0 &&
  !result.busy &&
  (result.stopReason === null || result.stopReason === 'budget');

/**
 * What the card says when the loop has ended on `last`, with the run's totals so far: `links.done`
 * or `links.doneAll` once nothing is left, or why it stopped. Null: the loop ended without a word
 * the card owns (a failed call goes through `errorMessage`).
 */
export const resolveLoopEndMessage = (
  last: AtmMapLinkResolveResultDto,
  totals: { resolved: number; failed: number; total: number },
): { key: string; params: Record<string, number>; tone: FeedbackTone } | null => {
  if (last.busy) return { key: 'atm.map.links.busy', params: {}, tone: 'warning' };
  if (last.stopReason === 'rateLimited') {
    return { key: 'atm.map.links.rateLimited', params: {}, tone: 'warning' };
  }
  if (last.stopReason === 'unreachable') {
    return { key: 'atm.map.links.unreachable', params: {}, tone: 'error' };
  }
  if (last.remaining > 0) return null;
  return totals.failed > 0
    ? { key: 'atm.map.links.done', params: totals, tone: 'warning' }
    : {
        key: 'atm.map.links.doneAll',
        params: { resolved: totals.resolved, total: totals.total },
        tone: 'success',
      };
};
