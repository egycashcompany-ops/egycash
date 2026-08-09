// IT's answers to the Files service's question (ADR-023).
//
// Two entity types carry ticket files, and each reuses a rule the module already enforces rather
// than restating it:
//
//   * `it/ticket`        — can this caller READ this ticket? Resolved through the same
//     `scopeSelector(ctx, 'itTicket.view')` every ticket endpoint uses, so FR-8's `own` scope
//     applies to attachments with no requester-specific branch anywhere.
//   * `it/ticketComment` — can they read the ticket AND, if the comment is `internal`, do they
//     hold `itTicket.edit`? That is FR-7, the same predicate `maySeeInternal` already expresses
//     for the stream. A second copy of it would be a second thing to get wrong.
//
// No permission is minted here. The authorizer only asks questions the module could already
// answer; what changes is that the FILES service now asks them too.
import { hasPermission, scopeSelector, type AuthContext } from '../../../shared/types';
import { type FileEntityAuthorizer } from '../../../platform/files';
import { itTicketRepository } from './ticket.repository';
import { ItTicketEventModel } from './ticket-event.model';

/** Read scope for tickets — identical to the controllers', so the two can never drift apart. */
const ticketScope = (ctx: AuthContext) => scopeSelector(ctx, 'itTicket.view');

/**
 * Can this caller see the ticket at all?
 *
 * `findById` applies the scope, so an out-of-scope ticket comes back null and the answer is no —
 * the same reason a requester's `GET /it/tickets/:id` answers 404 for somebody else's ticket.
 */
const canReadTicket = async (ctx: AuthContext, ticketId: string): Promise<boolean> =>
  (await itTicketRepository.findById(ticketId, ticketScope(ctx))) !== null;

/**
 * Attachments on the ticket itself.
 *
 * Reading and writing take the same answer deliberately: the design makes direct ticket
 * attachments public to whoever can see the ticket (§13-Q9), and someone who can open a ticket can
 * attach the screenshot that explains it. Narrowing writes to technicians would stop a requester
 * from attaching the very evidence they were asked for.
 */
const ticketAuthorizer: FileEntityAuthorizer = {
  entityType: 'ticket',
  authorize: async ({ ctx, entityId }) => canReadTicket(ctx, entityId),
};

/**
 * Attachments on one comment in the stream — FR-7, applied to bytes.
 *
 * The comment row is read UNSCOPED here on purpose: its visibility is decided by the rule below,
 * not by a collection filter, and the ticket check that follows is what bounds the caller. A row
 * that does not exist denies, which is the fail-closed answer for a deleted comment.
 */
const ticketCommentAuthorizer: FileEntityAuthorizer = {
  entityType: 'ticketComment',
  authorize: async ({ ctx, entityId }) => {
    const comment = await ItTicketEventModel.findOne({ _id: entityId, isDeleted: false })
      .select({ subjectId: 1, visibility: 1 })
      .lean<{ subjectId: unknown; visibility: string | null }>()
      .exec();
    if (comment === null) return false;
    // Internal notes never reach a caller without the work grant — the same gate the stream query
    // applies, so a note cannot be read through its attachment when it cannot be read directly.
    if (comment.visibility === 'internal' && !hasPermission(ctx, 'itTicket.edit')) return false;
    return canReadTicket(ctx, String(comment.subjectId));
  },
};

export const itFileEntityAuthorizers: FileEntityAuthorizer[] = [
  ticketAuthorizer,
  ticketCommentAuthorizer,
];
