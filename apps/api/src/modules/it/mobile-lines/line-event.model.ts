// `it_mobile_line_events` — a line's business history, append-only (ADR-021): registered, edited,
// handed over, returned, suspended, reactivated.
//
// Built from the module's one timeline factory, like the assets' and the tickets' streams, so the
// `minimize: false` lesson (PR #117) and the subject indexes come with it rather than being copied.
import { IT_MOBILE_LINE_EVENT_TYPES, type ItMobileLineEventType } from '@ecms/contracts';
import { buildItTimelineModel, type ItTimelineDoc } from '../shared/timeline.model';

export interface ItMobileLineEventDoc extends ItTimelineDoc {
  type: ItMobileLineEventType;
}

export const ItMobileLineEventModel = buildItTimelineModel<ItMobileLineEventDoc>({
  modelName: 'ItMobileLineEvent',
  collection: 'it_mobile_line_events',
  types: IT_MOBILE_LINE_EVENT_TYPES,
});
