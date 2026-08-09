// `it_ticket_events` — the ticket's history AND its conversation, in ONE append-only collection
// (design §2.6). Notes are entries in the stream, not a sibling collection — the recruitment
// timeline precedent — so the ticket page renders one source with no interleaving and no ordering
// ambiguity.
//
// This is IT-2's timeline factory with a different vocabulary and collection. Building a second
// history system here was the thing to avoid: the idiom appears twice in the product and once in
// the code, which is what the design asks for (§2.3) and what `buildItTimelineModel` exists for.
//
// Four fields extend the shared shape, and they are TYPED rather than stuffed into `metadata`,
// because the query layer has to filter on them:
//   * `fromStatus` / `toStatus` — every transition is one `statusChanged` row, so the pair IS the
//     transition; resolve, close, reopen and cancel are not four more types (§2.6).
//   * `body` / `visibility`     — a comment is a `commented` row. `internal` must be filterable in
//     the QUERY (FR-7), and you cannot index a probe into a free-form object.
import {
  IT_COMMENT_VISIBILITIES,
  IT_TICKET_EVENT_TYPES,
  IT_TICKET_STATUSES,
  type ItCommentVisibility,
  type ItTicketEventType,
  type ItTicketStatus,
} from '@ecms/contracts';
import { buildItTimelineModel, type ItTimelineDoc } from '../shared/timeline.model';

export interface ItTicketEventDoc extends ItTimelineDoc {
  type: ItTicketEventType;
  fromStatus: ItTicketStatus | null;
  toStatus: ItTicketStatus | null;
  body: string | null;
  visibility: ItCommentVisibility | null;
}

export const ItTicketEventModel = buildItTimelineModel<ItTicketEventDoc>({
  modelName: 'ItTicketEvent',
  collection: 'it_ticket_events',
  types: IT_TICKET_EVENT_TYPES,
  extraFields: {
    fromStatus: { type: String, enum: [...IT_TICKET_STATUSES, null], default: null },
    toStatus: { type: String, enum: [...IT_TICKET_STATUSES, null], default: null },
    body: { type: String, default: null },
    visibility: { type: String, enum: [...IT_COMMENT_VISIBILITIES, null], default: null },
  },
  extraIndexes: [
    // FR-7's read path: the requester's view is "this ticket, public rows only", so the filter
    // that hides internal notes has to be indexed rather than applied after the fact.
    [{ subjectId: 1, visibility: 1, at: -1 }, { name: 'ix_subject_visibility_at' }],
  ],
});
