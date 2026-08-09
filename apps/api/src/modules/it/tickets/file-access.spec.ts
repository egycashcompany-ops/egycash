// IT's two authorizers, tested as pure decisions with the data layer mocked.
//
// The integration suite proves these hold over HTTP; this proves the LOGIC in isolation, which is
// what tells a failure apart from a timing or wiring problem when the two disagree.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findOne, findTicketById } = vi.hoisted(() => ({
  findOne: vi.fn(),
  findTicketById: vi.fn(),
}));

vi.mock('./ticket-event.model', () => ({
  ItTicketEventModel: {
    findOne: (...args: unknown[]) => {
      findOne(...args);
      return {
        select: () => ({ lean: () => ({ exec: async () => findOne.mock.results.at(-1)?.value }) }),
      };
    },
  },
}));
vi.mock('./ticket.repository', () => ({
  itTicketRepository: { findById: findTicketById },
}));

const { itFileEntityAuthorizers } = await import('./file-access');
const byType = (entityType: string) => {
  const found = itFileEntityAuthorizers.find((a) => a.entityType === entityType);
  if (found === undefined) throw new Error(`no authorizer for ${entityType}`);
  return found;
};

const ctx = (permissions: Record<string, string>) =>
  ({ userId: 'u1', permissions }) as never;

const TICKET = { _id: 'T1' };

beforeEach(() => {
  findOne.mockReset();
  findTicketById.mockReset();
});

describe('it/ticket', () => {
  it('allows when the ticket is visible in the caller’s scope', async () => {
    findTicketById.mockResolvedValue(TICKET);
    await expect(
      byType('ticket').authorize({ ctx: ctx({}), entityId: 'T1', intent: 'read' }),
    ).resolves.toBe(true);
  });

  it('denies when the ticket is out of scope — the same reason its GET answers 404', async () => {
    findTicketById.mockResolvedValue(null);
    await expect(
      byType('ticket').authorize({ ctx: ctx({}), entityId: 'T1', intent: 'read' }),
    ).resolves.toBe(false);
  });
});

describe('it/ticketComment', () => {
  const comment = (visibility: string | null) => ({ subjectId: 'T1', visibility });

  it('allows a PUBLIC comment’s file to the ticket’s requester — no work grant needed', async () => {
    findOne.mockReturnValue(comment('public'));
    findTicketById.mockResolvedValue(TICKET);
    await expect(
      byType('ticketComment').authorize({ ctx: ctx({}), entityId: 'C1', intent: 'read' }),
    ).resolves.toBe(true);
  });

  it('denies an INTERNAL comment’s file without itTicket.edit (FR-7)', async () => {
    findOne.mockReturnValue(comment('internal'));
    findTicketById.mockResolvedValue(TICKET);
    await expect(
      byType('ticketComment').authorize({ ctx: ctx({}), entityId: 'C1', intent: 'read' }),
    ).resolves.toBe(false);
  });

  it('allows an INTERNAL comment’s file WITH itTicket.edit', async () => {
    findOne.mockReturnValue(comment('internal'));
    findTicketById.mockResolvedValue(TICKET);
    await expect(
      byType('ticketComment').authorize({
        ctx: ctx({ 'itTicket.edit': 'organization' }),
        entityId: 'C1',
        intent: 'read',
      }),
    ).resolves.toBe(true);
  });

  it('denies when the comment is gone — fail-closed on a deleted row', async () => {
    findOne.mockReturnValue(null);
    await expect(
      byType('ticketComment').authorize({ ctx: ctx({}), entityId: 'C1', intent: 'read' }),
    ).resolves.toBe(false);
  });

  it('denies a public comment on a ticket the caller cannot see', async () => {
    findOne.mockReturnValue(comment('public'));
    findTicketById.mockResolvedValue(null);
    await expect(
      byType('ticketComment').authorize({ ctx: ctx({}), entityId: 'C1', intent: 'read' }),
    ).resolves.toBe(false);
  });
});
