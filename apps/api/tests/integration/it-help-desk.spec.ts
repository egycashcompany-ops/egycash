// IT-3 integration suite: the help desk over real HTTP with real RBAC.
//
// Five things here are worth more than the rest, because each is a rule that would be invisible
// if it silently broke:
//
//   1. **The state machine.** Every legal transition walked, every illegal one refused. A help
//      desk that accepts an impossible move produces a record nobody can audit.
//   2. **FR-7 — internal comments.** Proven by reading the WIRE as the requester, not by reading a
//      flag: the body must never leave the server. A mapper that dropped a field would still have
//      shipped it.
//   3. **FR-8 / FR-14 — the requester.** `own` scope shows them their own tickets; ownership (not
//      a grant) lets them cancel one while it is still open, and comment on it publicly.
//   4. **The SLA snapshot.** Editing a priority must not move a running clock or rewrite history.
//   5. **Breach idempotency.** The sweep is run TWICE against the same overdue ticket; the stamp,
//      the history row and the event must each happen exactly once (FR-6).
//
// Error mapping is asserted deliberately and is not interchangeable: 400 = the body could not be
// READ (Zod / `.strict()`), 422 = it read fine but the domain refuses it, 409 = a conflict with
// state, 403 = the grant is missing, 404 = out of scope or absent.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  ItEvents,
  ItSettingKeys,
  SettingKeys,
  platformPermissions,
  type ItCatalogItemDto,
  type ItTicketDto,
  type ItTicketEventDto,
  type ItTicketPriorityDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { itPermissions } from '../../src/modules/it/it.module';
import { slaBreachSweep, ticketAutoCloseSweep } from '../../src/modules/it/tickets/ticket-sweeps';
import { ItTicketModel } from '../../src/modules/it/tickets/ticket.model';
import { subscribe } from '../../src/platform/kernel/event-bus';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;

let adminToken: string; // everything
let techToken: string; // itTicket.view/edit/assign/close — the technician
let techUserId: string;
let requesterToken: string; // itTicket.view at OWN scope + itTicket.create — the requester
let requesterUserId: string;
let otherRequesterToken: string; // a second requester, for the own-scope negative
let outsiderToken: string; // no IT grant at all

let categoryId: string;
let urgentPriorityId: string;
let normalPriorityId: string;
const seenEvents: { name: string; payload: unknown }[] = [];

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-it-helpdesk-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const mkUser = async (email: string): Promise<string> => {
  const { user } = await userService.create(
    {
      email,
      firstName: { ar: 'م', en: 'T' },
      lastName: { ar: 'م', en: 'T' },
      locale: 'en',
      organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  await userService.setPassword(String(user._id), PASSWORD, 'passwordReset');
  await userService.forceActivate(String(user._id));
  return String(user._id);
};

const login = async (email: string): Promise<string> => {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return (res.body as { data: { accessToken: string } }).data.accessToken;
};

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;

// In-process events fan out fire-and-forget — poll, never assert immediately (the fleet lesson).
const waitFor = async (predicate: () => boolean, ms = 2000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

// ── HTTP helpers ────────────────────────────────────────────────────────────

const openTicket = async (
  token = requesterToken,
  overrides: Record<string, unknown> = {},
): Promise<ItTicketDto> => {
  const res = await request(app)
    .post('/api/v1/it/tickets')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: 'Printer jams',
      description: 'It jams on every second page.',
      categoryId,
      priorityId: normalPriorityId,
      ...overrides,
    });
  expect(res.status).toBe(201);
  return data<ItTicketDto>(res);
};

const act = (
  id: string,
  action: string,
  body: Record<string, unknown>,
  token = techToken,
): request.Test =>
  request(app)
    .post(`/api/v1/it/tickets/${id}/${action}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

const getTicket = async (id: string, token = techToken): Promise<ItTicketDto> => {
  const res = await request(app)
    .get(`/api/v1/it/tickets/${id}`)
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  return data<ItTicketDto>(res);
};

const stream = async (id: string, token = techToken): Promise<ItTicketEventDto[]> => {
  const res = await request(app)
    .get(`/api/v1/it/tickets/${id}/comments?pageSize=100`)
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  return data<ItTicketEventDto[]>(res);
};

/** Walk a fresh ticket to `inProgress`, the state most transitions start from. */
const workingTicket = async (): Promise<ItTicketDto> => {
  const ticket = await openTicket();
  expect((await act(ticket.id, 'status', { to: 'inProgress' })).status).toBe(200);
  return getTicket(ticket.id);
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  for (const name of [
    ItEvents.TicketOpened,
    ItEvents.TicketAssigned,
    ItEvents.TicketStatusChanged,
    ItEvents.TicketSlaBreached,
  ]) {
    subscribe(name, `spec.${name}`, (envelope) => {
      seenEvents.push({ name, payload: envelope.payload });
    });
  }

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...itPermissions].map((p) => p.key),
  );
  const adminId = await mkUser('hd-admin@ecms.local');
  await rbacService.ensureAssignment(adminId, String(superAdmin._id), 'organization');

  const ctx: AuthContext = {
    userId: adminId,
    sessionId: 'seed',
    branchId: null,
    departmentId: null,
    sectionId: null,
    locale: 'en',
    permissions: { 'setting.edit': 'organization' },
    permissionVersion: 1,
    isPrivileged: true,
  };
  await settingsService.set(ctx, {
    key: SettingKeys.TotpEnforcedForPrivileged,
    scope: 'organization',
    value: false,
  });
  adminToken = await login('hd-admin@ecms.local');

  // The technician: works tickets, dispatches them, closes them — but is NOT an admin, so the
  // SLA policy stays out of reach. That separation is §7's, and it is asserted below.
  const techRole = await rbacService.createRole(
    {
      name: { en: 'IT technician', ar: 'فني دعم' },
      permissionKeys: ['itTicket.view', 'itTicket.edit', 'itTicket.assign', 'itTicket.close'],
    },
    adminId,
  );
  techUserId = await mkUser('hd-tech@ecms.local');
  await rbacService.ensureAssignment(techUserId, String(techRole._id), 'organization');
  techToken = await login('hd-tech@ecms.local');

  // The requester: opens tickets and reads their OWN. `own` scope is the whole of FR-8 — there is
  // no requester-specific code path anywhere in the module.
  const requesterRole = await rbacService.createRole(
    {
      name: { en: 'Staff', ar: 'موظف' },
      permissionKeys: ['itTicket.view', 'itTicket.create'],
    },
    adminId,
  );
  requesterUserId = await mkUser('hd-user@ecms.local');
  await rbacService.ensureAssignment(requesterUserId, String(requesterRole._id), 'own');
  requesterToken = await login('hd-user@ecms.local');

  const otherId = await mkUser('hd-user2@ecms.local');
  await rbacService.ensureAssignment(otherId, String(requesterRole._id), 'own');
  otherRequesterToken = await login('hd-user2@ecms.local');

  const outsiderRole = await rbacService.createRole(
    { name: { en: 'Outsider', ar: 'بلا صلاحية' }, permissionKeys: ['user.view'] },
    adminId,
  );
  const outsiderId = await mkUser('hd-outsider@ecms.local');
  await rbacService.ensureAssignment(outsiderId, String(outsiderRole._id), 'organization');
  outsiderToken = await login('hd-outsider@ecms.local');

  const category = await request(app)
    .post('/api/v1/it/catalog-items')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ kind: 'ticketCategory', name: { ar: 'أعطال أجهزة', en: 'Hardware' } });
  expect(category.status).toBe(201);
  categoryId = data<ItCatalogItemDto>(category).id;

  const mkPriority = async (
    en: string,
    ar: string,
    rank: number,
    responseMinutes: number,
    resolutionMinutes: number,
  ): Promise<string> => {
    const res = await request(app)
      .post('/api/v1/it/ticket-priorities')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: { ar, en }, rank, responseMinutes, resolutionMinutes });
    expect(res.status).toBe(201);
    return data<ItTicketPriorityDto>(res).id;
  };
  urgentPriorityId = await mkPriority('Urgent', 'عاجل', 0, 15, 120);
  normalPriorityId = await mkPriority('Normal', 'عادي', 10, 60, 480);
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

// ── Priorities: the SLA policy ──────────────────────────────────────────────

describe('ticket priorities (the SLA policy)', () => {
  it('refuses a policy that resolves faster than it responds — 400, the body is unreadable', async () => {
    const res = await request(app)
      .post('/api/v1/it/ticket-priorities')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: { ar: 'خطأ', en: 'Broken' }, rank: 50, responseMinutes: 240, resolutionMinutes: 30 });
    // The cross-field rule lives in the SCHEMA, so this never reaches the service.
    expect(res.status).toBe(400);
  });

  it('refuses a second ACTIVE priority at the same rank — 409, a conflict with state', async () => {
    const res = await request(app)
      .post('/api/v1/it/ticket-priorities')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: { ar: 'مكرر', en: 'Duplicate' }, rank: 0, responseMinutes: 15, resolutionMinutes: 120 });
    expect(res.status).toBe(409);
  });

  // A partial edit may legitimately send one target alone, so the pair rule cannot live in the
  // schema for updates — the service checks the MERGED values, which is a 422 (a domain refusal),
  // not a 400.
  it('refuses an edit that would invert the pair — 422, checked against the merged values', async () => {
    const list = await request(app)
      .get('/api/v1/it/ticket-priorities?pageSize=100')
      .set('Authorization', `Bearer ${adminToken}`);
    const normal = data<ItTicketPriorityDto[]>(list).find((p) => p.id === normalPriorityId);
    expect(normal).toBeDefined();
    const res = await request(app)
      .patch(`/api/v1/it/ticket-priorities/${normalPriorityId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      // resolutionMinutes stays 480; a response of 600 would overtake it.
      .send({ responseMinutes: 600, version: normal?.version ?? 0 });
    expect(res.status).toBe(422);
  });

  it('offers no delete — every ticket ever opened points at a priority (FR-11)', async () => {
    const res = await request(app)
      .delete(`/api/v1/it/ticket-priorities/${normalPriorityId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('lets anyone who can open a ticket READ the priorities — the dropdown must populate', async () => {
    const res = await request(app)
      .get('/api/v1/it/ticket-priorities')
      .set('Authorization', `Bearer ${requesterToken}`);
    expect(res.status).toBe(200);
    expect(data<ItTicketPriorityDto[]>(res).length).toBeGreaterThan(0);
  });

  it('but only the SLA admin may write them — a technician cannot rewrite the promise', async () => {
    const res = await request(app)
      .post('/api/v1/it/ticket-priorities')
      .set('Authorization', `Bearer ${techToken}`)
      .send({ name: { ar: 'ذاتي', en: 'Self-serve' }, rank: 99, responseMinutes: 1, resolutionMinutes: 2 });
    expect(res.status).toBe(403);
  });

  it('refuses the priorities list to someone with neither grant', async () => {
    const res = await request(app)
      .get('/api/v1/it/ticket-priorities')
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(res.status).toBe(403);
  });
});

// ── Opening a ticket ────────────────────────────────────────────────────────

describe('opening a ticket', () => {
  it('allocates a code, sets the requester from the CALLER, and snapshots the SLA', async () => {
    const ticket = await openTicket(requesterToken, { priorityId: urgentPriorityId });
    expect(ticket.ticketCode).toMatch(/^TKT-\d{5,}$/);
    expect(ticket.status).toBe('open');
    // The requester is the authenticated caller, never a field.
    expect(ticket.requesterUserId).toBe(requesterUserId);
    expect(ticket.assignedTechnicianUserId).toBeNull();
    expect(ticket.reopenCount).toBe(0);
    // The SNAPSHOT — the urgent policy's numbers, copied onto the ticket.
    expect(ticket.sla.policy).toEqual({ responseMinutes: 15, resolutionMinutes: 120 });
    expect(new Date(ticket.sla.responseDueAt).getTime()).toBeLessThan(
      new Date(ticket.sla.resolutionDueAt).getTime(),
    );
    expect(ticket.sla.firstResponseAt).toBeNull();
    expect(ticket.sla.responseBreachedAt).toBeNull();
    expect(ticket.sla.resolutionBreachedAt).toBeNull();
    expect(ticket.sla.pausedMs).toBe(0);
  });

  it('gives consecutive tickets consecutive codes — the sequence never reuses one (FR-1)', async () => {
    const first = await openTicket();
    const second = await openTicket();
    const seq = (code: string): number => Number(code.slice(4));
    expect(seq(second.ticketCode)).toBe(seq(first.ticketCode) + 1);
  });

  it('writes an `opened` row as the stream’s first entry', async () => {
    const ticket = await openTicket();
    const entries = await stream(ticket.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.type).toBe('opened');
    expect(entries[0]?.actorUserId).toBe(requesterUserId);
  });

  it('emits TicketOpened, so automation can trigger on it (§8.1)', async () => {
    const ticket = await openTicket();
    await waitFor(() =>
      seenEvents.some(
        (e) =>
          e.name === ItEvents.TicketOpened &&
          (e.payload as { ticketId?: string }).ticketId === ticket.id,
      ),
    );
    const opened = seenEvents.find(
      (e) =>
        e.name === ItEvents.TicketOpened &&
        (e.payload as { ticketId?: string }).ticketId === ticket.id,
    );
    expect((opened?.payload as { ticketCode?: string }).ticketCode).toBe(ticket.ticketCode);
  });

  // A reference that does not resolve is a DOMAIN refusal, not a missing page: the ticket the
  // caller asked for was never created, so 422 (the body read fine, the rule says no) rather than
  // a 404 that would suggest the endpoint itself is gone.
  it('refuses an unknown category, an unknown priority, and an ARCHIVED one', async () => {
    const missing = '0000000000000000000000ff';
    const post = (overrides: Record<string, unknown>) =>
      request(app)
        .post('/api/v1/it/tickets')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ title: 'x', description: 'y', categoryId, priorityId: normalPriorityId, ...overrides });

    expect((await post({ categoryId: missing })).status).toBe(422);
    expect((await post({ priorityId: missing })).status).toBe(422);

    // Archiving is how a category or a priority is retired (FR-11) — a retired one must not be
    // openable against, or archiving would mean nothing.
    const retired = await request(app)
      .post('/api/v1/it/catalog-items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ kind: 'ticketCategory', name: { ar: 'مُلغى', en: 'Retired' } });
    const row = data<ItCatalogItemDto>(retired);
    await request(app)
      .patch(`/api/v1/it/catalog-items/${row.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false, version: row.version });
    expect((await post({ categoryId: row.id })).status).toBe(422);
  });

  it('refuses every server-owned field — 400, an unknown key is an unreadable body', async () => {
    for (const injected of [{ status: 'resolved' }, { ticketCode: 'TKT-00001' }, { requesterUserId }]) {
      const res = await request(app)
        .post('/api/v1/it/tickets')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ title: 'x', description: 'y', categoryId, priorityId: normalPriorityId, ...injected });
      expect(res.status, JSON.stringify(injected)).toBe(400);
    }
  });

  it('refuses someone with no create grant', async () => {
    const res = await request(app)
      .post('/api/v1/it/tickets')
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ title: 'x', description: 'y', categoryId, priorityId: normalPriorityId });
    expect(res.status).toBe(403);
  });
});

// ── The state machine ───────────────────────────────────────────────────────

describe('the ticket state machine', () => {
  it('walks the full path: open → inProgress → onHold → inProgress → resolved → closed', async () => {
    const ticket = await openTicket();
    expect((await act(ticket.id, 'status', { to: 'inProgress' })).status).toBe(200);
    expect((await getTicket(ticket.id)).status).toBe('inProgress');

    expect((await act(ticket.id, 'status', { to: 'onHold', reason: 'waiting on the vendor' })).status).toBe(200);
    expect((await getTicket(ticket.id)).status).toBe('onHold');

    expect((await act(ticket.id, 'status', { to: 'inProgress' })).status).toBe(200);
    expect((await act(ticket.id, 'resolve', { summary: 'replaced the roller' })).status).toBe(200);
    const resolved = await getTicket(ticket.id);
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolution?.summary).toBe('replaced the roller');
    expect(resolved.resolution?.resolvedByUserId).toBe(techUserId);

    expect((await act(ticket.id, 'close', { note: 'confirmed by the requester' })).status).toBe(200);
    const closed = await getTicket(ticket.id);
    expect(closed.status).toBe('closed');
    expect(closed.closedAt).not.toBeNull();
  });

  it('reopens from CLOSED, back into inProgress, counting the reopen', async () => {
    const ticket = await workingTicket();
    await act(ticket.id, 'resolve', { summary: 'done' });
    await act(ticket.id, 'close', {});
    expect((await act(ticket.id, 'reopen', { reason: 'it jammed again' })).status).toBe(200);
    const after = await getTicket(ticket.id);
    expect(after.status).toBe('inProgress');
    expect(after.reopenCount).toBe(1);
  });

  it('reopens from RESOLVED too — the fix is questioned before anyone closes it', async () => {
    const ticket = await workingTicket();
    await act(ticket.id, 'resolve', { summary: 'done' });
    expect((await act(ticket.id, 'reopen', { reason: 'not actually fixed' })).status).toBe(200);
    expect((await getTicket(ticket.id)).status).toBe('inProgress');
  });

  // An illegal move is a CONFLICT with the ticket's current state, so 409 — the same code the
  // custody machine answers when an asset is not out. It is not a 422: the request is not asking
  // for something forbidden in principle, it is asking for something impossible from HERE.
  it('refuses every illegal move — 409, a conflict with the state the ticket is in', async () => {
    const open = await openTicket();
    // open → resolved skips the work entirely.
    expect((await act(open.id, 'resolve', { summary: 'magic' })).status).toBe(409);
    // open → closed skips the answer.
    expect((await act(open.id, 'close', {})).status).toBe(409);

    const resolved = await workingTicket();
    await act(resolved.id, 'resolve', { summary: 'done' });
    // resolved → onHold: there is nothing left to pause.
    expect((await act(resolved.id, 'status', { to: 'onHold', reason: 'x' })).status).toBe(409);
    // resolved → cancelled: cancelling means "never real", which a resolved ticket disproves.
    expect((await act(resolved.id, 'cancel', { reason: 'x' })).status).toBe(409);
  });

  it('makes cancelled terminal — nothing moves a cancelled ticket, ever', async () => {
    const ticket = await openTicket();
    expect((await act(ticket.id, 'cancel', { reason: 'opened by mistake' })).status).toBe(200);
    expect((await getTicket(ticket.id)).status).toBe('cancelled');
    expect((await act(ticket.id, 'status', { to: 'inProgress' })).status).toBe(409);
    expect((await act(ticket.id, 'reopen', { reason: 'changed my mind' })).status).toBe(409);
    expect((await act(ticket.id, 'resolve', { summary: 'x' })).status).toBe(409);
  });

  it('requires a reason to hold — 400, the schema refuses it before the service', async () => {
    const ticket = await workingTicket();
    expect((await act(ticket.id, 'status', { to: 'onHold' })).status).toBe(400);
    expect((await act(ticket.id, 'status', { to: 'onHold', reason: '   ' })).status).toBe(400);
  });

  it('refuses a status the generic transition does not own — 400', async () => {
    const ticket = await workingTicket();
    // `resolved` has its own endpoint because it carries a summary. Naming it here is unreadable.
    expect((await act(ticket.id, 'status', { to: 'resolved' })).status).toBe(400);
  });

  it('requires the fact each named transition exists to carry — 400 without it', async () => {
    const ticket = await workingTicket();
    expect((await act(ticket.id, 'resolve', {})).status).toBe(400);
    expect((await act(ticket.id, 'cancel', {})).status).toBe(400);
    const resolved = await workingTicket();
    await act(resolved.id, 'resolve', { summary: 'done' });
    await act(resolved.id, 'close', {});
    expect((await act(resolved.id, 'reopen', {})).status).toBe(400);
  });

  // §8.1: close, reopen and cancel are `to` VALUES, not four more event names. One event per move,
  // whichever endpoint carried it — otherwise a subscriber has to know four names to hear one fact.
  it('emits exactly ONE TicketStatusChanged per move, whichever endpoint carried it', async () => {
    const ticket = await workingTicket();
    const before = seenEvents.filter(
      (e) =>
        e.name === ItEvents.TicketStatusChanged &&
        (e.payload as { ticketId?: string }).ticketId === ticket.id,
    ).length;
    await act(ticket.id, 'resolve', { summary: 'done' });
    await waitFor(
      () =>
        seenEvents.filter(
          (e) =>
            e.name === ItEvents.TicketStatusChanged &&
            (e.payload as { ticketId?: string }).ticketId === ticket.id,
        ).length ===
        before + 1,
    );
    const moves = seenEvents.filter(
      (e) =>
        e.name === ItEvents.TicketStatusChanged &&
        (e.payload as { ticketId?: string }).ticketId === ticket.id,
    );
    expect(moves).toHaveLength(before + 1);
    const last = moves[moves.length - 1]?.payload as { from?: string; to?: string };
    expect(last.from).toBe('inProgress');
    expect(last.to).toBe('resolved');
  });
});

// ── Assignment ──────────────────────────────────────────────────────────────

describe('assignment', () => {
  it('assigning an OPEN ticket also starts the work, in one move', async () => {
    const ticket = await openTicket();
    const res = await act(ticket.id, 'assign', { technicianUserId: techUserId });
    expect(res.status).toBe(200);
    const after = data<ItTicketDto>(res);
    expect(after.assignedTechnicianUserId).toBe(techUserId);
    expect(after.status).toBe('inProgress');
    // Two facts happened, so the stream must read as two things — not one blurred row.
    const types = (await stream(ticket.id)).map((e) => e.type);
    expect(types).toContain('assigned');
    expect(types).toContain('statusChanged');
  });

  it('reassigning a ticket already in progress does NOT move its status', async () => {
    const ticket = await workingTicket();
    const res = await act(ticket.id, 'assign', { technicianUserId: techUserId });
    expect(res.status).toBe(200);
    expect(data<ItTicketDto>(res).status).toBe('inProgress');
  });

  it('stops the response clock the first time work starts', async () => {
    const ticket = await openTicket();
    expect(ticket.sla.firstResponseAt).toBeNull();
    await act(ticket.id, 'assign', { technicianUserId: techUserId });
    const after = await getTicket(ticket.id);
    expect(after.sla.firstResponseAt).not.toBeNull();
  });

  it('needs the assign grant specifically — working a ticket is not dispatching it', async () => {
    const ticket = await openTicket();
    const workerOnly = await rbacService.createRole(
      { name: { en: 'Worker', ar: 'منفذ' }, permissionKeys: ['itTicket.view', 'itTicket.edit'] },
      techUserId,
    );
    const workerId = await mkUser('hd-worker@ecms.local');
    await rbacService.ensureAssignment(workerId, String(workerOnly._id), 'organization');
    const workerToken = await login('hd-worker@ecms.local');
    expect((await act(ticket.id, 'assign', { technicianUserId: techUserId }, workerToken)).status).toBe(403);
    // …but the same principal CAN work it, which is the grant they hold.
    expect((await act(ticket.id, 'status', { to: 'inProgress' }, workerToken)).status).toBe(200);
  });

  it('emits TicketAssigned with the technician', async () => {
    const ticket = await openTicket();
    await act(ticket.id, 'assign', { technicianUserId: techUserId });
    await waitFor(() =>
      seenEvents.some(
        (e) =>
          e.name === ItEvents.TicketAssigned &&
          (e.payload as { ticketId?: string }).ticketId === ticket.id,
      ),
    );
    const assigned = seenEvents.find(
      (e) =>
        e.name === ItEvents.TicketAssigned &&
        (e.payload as { ticketId?: string }).ticketId === ticket.id,
    );
    expect((assigned?.payload as { technicianUserId?: string }).technicianUserId).toBe(techUserId);
  });
});

// ── The requester (FR-8, FR-14) ─────────────────────────────────────────────

describe('the requester', () => {
  it('sees their OWN tickets and nobody else’s — `own` scope, not special-case code (FR-8)', async () => {
    const mine = await openTicket(requesterToken);
    const theirs = await openTicket(otherRequesterToken);

    const list = await request(app)
      .get('/api/v1/it/tickets?pageSize=100')
      .set('Authorization', `Bearer ${requesterToken}`);
    expect(list.status).toBe(200);
    const ids = data<ItTicketDto[]>(list).map((t) => t.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
    // Reading the other ticket DIRECTLY is a 404, not a 403: out of scope means it does not exist
    // for this caller, and a 403 would confirm that it does.
    const direct = await request(app)
      .get(`/api/v1/it/tickets/${theirs.id}`)
      .set('Authorization', `Bearer ${requesterToken}`);
    expect(direct.status).toBe(404);
  });

  it('`mine=true` narrows the queue for a caller who can see everything', async () => {
    const mine = await openTicket(requesterToken);
    const res = await request(app)
      .get('/api/v1/it/tickets?mine=true&pageSize=100')
      .set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(200);
    // The technician opened none of these — their own filtered queue must be empty of the
    // requester's ticket.
    expect(data<ItTicketDto[]>(res).map((t) => t.id)).not.toContain(mine.id);
  });

  // FR-14, and the whole point is that NO permission is minted for it. Ownership is the rule.
  it('cancels their OWN ticket while it is still open, holding no work grant at all', async () => {
    const ticket = await openTicket(requesterToken);
    const res = await act(ticket.id, 'cancel', { reason: 'solved itself' }, requesterToken);
    expect(res.status).toBe(200);
    expect(data<ItTicketDto>(res).status).toBe('cancelled');
  });

  // 403, not 409: the MOVE is legal (inProgress → cancelled is in the table) — it is this CALLER
  // who may not make it, because their licence to cancel expired the moment work began. A
  // technician holding `itTicket.close` cancels the same ticket without trouble, which is the
  // other half of the assertion.
  it('cannot cancel their own ticket once work has started — 403, not a state conflict', async () => {
    const ticket = await openTicket(requesterToken);
    await act(ticket.id, 'status', { to: 'inProgress' });
    expect((await act(ticket.id, 'cancel', { reason: 'changed my mind' }, requesterToken)).status).toBe(403);
    expect((await act(ticket.id, 'cancel', { reason: 'duplicate report' })).status).toBe(200);
  });

  it('cannot cancel somebody else’s ticket — it is not even visible to them', async () => {
    const theirs = await openTicket(otherRequesterToken);
    const res = await act(theirs.id, 'cancel', { reason: 'not mine' }, requesterToken);
    expect(res.status).toBe(404);
  });

  it('comments PUBLICLY on their own ticket without any work grant (FR-14)', async () => {
    const ticket = await openTicket(requesterToken);
    const res = await request(app)
      .post(`/api/v1/it/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({ body: 'it is getting worse' });
    expect(res.status).toBe(201);
    expect(data<ItTicketEventDto>(res).visibility).toBe('public');
  });

  it('cannot post an INTERNAL note — that needs the work grant', async () => {
    const ticket = await openTicket(requesterToken);
    const res = await request(app)
      .post(`/api/v1/it/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({ body: 'sneaky', visibility: 'internal' });
    expect(res.status).toBe(403);
  });

  it('cannot edit their own ticket’s fields — reporting is not working', async () => {
    const ticket = await openTicket(requesterToken);
    const res = await request(app)
      .patch(`/api/v1/it/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({ priorityId: urgentPriorityId, version: ticket.version });
    expect(res.status).toBe(403);
  });
});

// ── FR-7: internal comments never leave the server ──────────────────────────

describe('internal comments (FR-7)', () => {
  it('are filtered out of the requester’s stream — in the QUERY, not in the UI', async () => {
    const ticket = await openTicket(requesterToken);
    await act(ticket.id, 'status', { to: 'inProgress' });

    const internal = await request(app)
      .post(`/api/v1/it/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ body: 'the vendor RMA is late again', visibility: 'internal' });
    expect(internal.status).toBe(201);
    const publicOne = await request(app)
      .post(`/api/v1/it/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ body: 'we have ordered the part', visibility: 'public' });
    expect(publicOne.status).toBe(201);

    const asTech = await stream(ticket.id, techToken);
    expect(asTech.filter((e) => e.visibility === 'internal')).toHaveLength(1);

    // The requester's view. Asserting on the WIRE, not on a field: the body must not be present
    // anywhere in the response, because a mapper that dropped a key would still have sent it.
    const asRequester = await request(app)
      .get(`/api/v1/it/tickets/${ticket.id}/comments?pageSize=100`)
      .set('Authorization', `Bearer ${requesterToken}`);
    expect(asRequester.status).toBe(200);
    expect(JSON.stringify(asRequester.body)).not.toContain('the vendor RMA is late again');
    const entries = data<ItTicketEventDto[]>(asRequester);
    expect(entries.some((e) => e.visibility === 'internal')).toBe(false);
    // …and the filter must not swallow the rest of the history, which carries no visibility at all.
    expect(entries.some((e) => e.type === 'opened')).toBe(true);
    expect(entries.some((e) => e.body === 'we have ordered the part')).toBe(true);
  });

  it('a public technician comment stamps the first response; an internal one does not', async () => {
    const quiet = await openTicket(requesterToken);
    await request(app)
      .post(`/api/v1/it/tickets/${quiet.id}/comments`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ body: 'noted internally', visibility: 'internal' });
    // An internal note is not an answer to the requester, so the response promise is still open.
    expect((await getTicket(quiet.id)).sla.firstResponseAt).toBeNull();

    const answered = await openTicket(requesterToken);
    await request(app)
      .post(`/api/v1/it/tickets/${answered.id}/comments`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ body: 'on our way', visibility: 'public' });
    expect((await getTicket(answered.id)).sla.firstResponseAt).not.toBeNull();
  });

  it('a requester’s own comment does not count as the help desk responding', async () => {
    const ticket = await openTicket(requesterToken);
    await request(app)
      .post(`/api/v1/it/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({ body: 'any update?' });
    expect((await getTicket(ticket.id)).sla.firstResponseAt).toBeNull();
  });

  it('refuses a comment on a cancelled ticket', async () => {
    const ticket = await openTicket(requesterToken);
    await act(ticket.id, 'cancel', { reason: 'mistake' }, requesterToken);
    const res = await request(app)
      .post(`/api/v1/it/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({ body: 'one more thing' });
    expect(res.status).toBe(422);
  });
});

// ── The SLA snapshot ────────────────────────────────────────────────────────

describe('the SLA snapshot', () => {
  it('does not move when the priority is edited afterwards', async () => {
    const editable = await request(app)
      .post('/api/v1/it/ticket-priorities')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: { ar: 'مؤقتة', en: 'Tunable' }, rank: 40, responseMinutes: 30, resolutionMinutes: 240 });
    expect(editable.status).toBe(201);
    const priority = data<ItTicketPriorityDto>(editable);

    const ticket = await openTicket(requesterToken, { priorityId: priority.id });
    expect(ticket.sla.policy).toEqual({ responseMinutes: 30, resolutionMinutes: 240 });
    const dueBefore = ticket.sla.resolutionDueAt;

    const edited = await request(app)
      .patch(`/api/v1/it/ticket-priorities/${priority.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ responseMinutes: 5, resolutionMinutes: 10, version: priority.version });
    expect(edited.status).toBe(200);

    // The open ticket keeps what it was promised — targets AND deadlines.
    const after = await getTicket(ticket.id);
    expect(after.sla.policy).toEqual({ responseMinutes: 30, resolutionMinutes: 240 });
    expect(after.sla.resolutionDueAt).toBe(dueBefore);

    // …and the NEW promise applies to the next ticket, which is the point of editing it.
    const next = await openTicket(requesterToken, { priorityId: priority.id });
    expect(next.sla.policy).toEqual({ responseMinutes: 5, resolutionMinutes: 10 });
  });

  it('does not re-snapshot when a ticket’s priority is changed on the ticket itself', async () => {
    const ticket = await openTicket(requesterToken, { priorityId: normalPriorityId });
    const dueBefore = ticket.sla.resolutionDueAt;
    const res = await request(app)
      .patch(`/api/v1/it/tickets/${ticket.id}`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ priorityId: urgentPriorityId, version: ticket.version });
    expect(res.status).toBe(200);
    const after = data<ItTicketDto>(res);
    expect(after.priorityId).toBe(urgentPriorityId);
    // The promise made at opening stands; the change is a fact in the stream, not a new clock.
    expect(after.sla.resolutionDueAt).toBe(dueBefore);
    expect((await stream(ticket.id)).some((e) => e.type === 'priorityChanged')).toBe(true);
  });

  it('banks the paused time while a ticket sits on hold', async () => {
    const ticket = await workingTicket();
    expect((await act(ticket.id, 'status', { to: 'onHold', reason: 'vendor' })).status).toBe(200);
    const held = await getTicket(ticket.id);
    expect(held.sla.holdStartedAt).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect((await act(ticket.id, 'status', { to: 'inProgress' })).status).toBe(200);
    const resumed = await getTicket(ticket.id);
    expect(resumed.sla.holdStartedAt).toBeNull();
    expect(resumed.sla.pausedMs).toBeGreaterThan(0);
  });
});

// ── The sweeps ──────────────────────────────────────────────────────────────

describe('the SLA breach sweep (§4.5, FR-6)', () => {
  /** Drag a live ticket's due dates into the past, the way real time would. */
  const backdate = async (id: string): Promise<void> => {
    const past = new Date(Date.now() - 60 * 60_000);
    await ItTicketModel.updateOne(
      { _id: id },
      { $set: { 'sla.responseDueAt': past, 'sla.resolutionDueAt': past } },
    ).exec();
  };

  it('stamps a breach once, and running it AGAIN changes nothing', async () => {
    const ticket = await openTicket(requesterToken);
    await backdate(ticket.id);

    const first = await slaBreachSweep();
    expect(first.stamped).toBeGreaterThan(0);
    const stamped = await getTicket(ticket.id);
    expect(stamped.sla.responseBreachedAt).not.toBeNull();
    expect(stamped.sla.resolutionBreachedAt).not.toBeNull();

    const breachRows = (await stream(ticket.id)).filter((e) => e.type === 'slaBreached');
    expect(breachRows).toHaveLength(2); // one per phase

    // The stamp IS the idempotency mark: the second run finds nothing to do.
    const second = await slaBreachSweep();
    const afterSecond = await getTicket(ticket.id);
    expect(afterSecond.sla.responseBreachedAt).toBe(stamped.sla.responseBreachedAt);
    expect(afterSecond.sla.resolutionBreachedAt).toBe(stamped.sla.resolutionBreachedAt);
    expect((await stream(ticket.id)).filter((e) => e.type === 'slaBreached')).toHaveLength(2);
    expect(second.stamped).toBe(0);
  });

  it('resolving late does NOT un-breach the ticket — the stamp is permanent', async () => {
    const ticket = await workingTicket();
    await backdate(ticket.id);
    await slaBreachSweep();
    await act(ticket.id, 'resolve', { summary: 'late but done' });
    const after = await getTicket(ticket.id);
    expect(after.status).toBe('resolved');
    expect(after.sla.resolutionBreachedAt).not.toBeNull();
  });

  it('leaves a ticket whose clocks are still running alone', async () => {
    const ticket = await openTicket(requesterToken);
    await slaBreachSweep();
    const after = await getTicket(ticket.id);
    expect(after.sla.responseBreachedAt).toBeNull();
    expect(after.sla.resolutionBreachedAt).toBeNull();
  });

  it('never breaches a response clock that has already stopped', async () => {
    const ticket = await openTicket(requesterToken);
    await act(ticket.id, 'assign', { technicianUserId: techUserId }); // stamps firstResponseAt
    await backdate(ticket.id);
    await slaBreachSweep();
    const after = await getTicket(ticket.id);
    expect(after.sla.responseBreachedAt).toBeNull();
    // …while the resolution promise is still live, so THAT one breaches.
    expect(after.sla.resolutionBreachedAt).not.toBeNull();
  });

  // Nobody is behind a sweep, which is exactly why the audit row matters (the contract-generation
  // precedent): without it, the only record of an automated decision is a status that changed by
  // itself. Read over the real audit API, so the assertion covers what an auditor would actually
  // be able to retrieve.
  it('records the breach in the audit trail, where an auditor can find it', async () => {
    const ticket = await openTicket(requesterToken);
    await backdate(ticket.id);
    await slaBreachSweep();
    const res = await request(app)
      .get(`/api/v1/platform/audit-logs?entityType=ticket&entityId=${ticket.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const actions = data<{ action: string }[]>(res).map((row) => row.action);
    expect(actions).toContain('slaBreached');
  });

  it('emits TicketSlaBreached with the phase', async () => {
    const ticket = await openTicket(requesterToken);
    await backdate(ticket.id);
    await slaBreachSweep();
    await waitFor(() =>
      seenEvents.some(
        (e) =>
          e.name === ItEvents.TicketSlaBreached &&
          (e.payload as { ticketId?: string }).ticketId === ticket.id,
      ),
    );
    const phases = seenEvents
      .filter(
        (e) =>
          e.name === ItEvents.TicketSlaBreached &&
          (e.payload as { ticketId?: string }).ticketId === ticket.id,
      )
      .map((e) => (e.payload as { phase?: string }).phase);
    expect(phases).toContain('response');
    expect(phases).toContain('resolution');
  });

  it('the breached filter reads the STAMPS, so a breached ticket is findable', async () => {
    const ticket = await openTicket(requesterToken);
    await backdate(ticket.id);
    await slaBreachSweep();
    const res = await request(app)
      .get('/api/v1/it/tickets?breached=true&pageSize=100')
      .set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(200);
    expect(data<ItTicketDto[]>(res).map((t) => t.id)).toContain(ticket.id);
  });
});

describe('the auto-close sweep (§4.4)', () => {
  const backdateResolution = async (id: string, days: number): Promise<void> => {
    const past = new Date(Date.now() - days * 86_400_000);
    await ItTicketModel.updateOne({ _id: id }, { $set: { 'resolution.resolvedAt': past } }).exec();
  };

  it('closes a ticket that has sat resolved past the window, as the SYSTEM', async () => {
    const ticket = await workingTicket();
    await act(ticket.id, 'resolve', { summary: 'done' });
    await backdateResolution(ticket.id, 30);

    const result = await ticketAutoCloseSweep();
    expect(result.closed).toBeGreaterThan(0);
    const after = await getTicket(ticket.id);
    expect(after.status).toBe('closed');
    expect(after.closedAt).not.toBeNull();
    // The stream must say the SYSTEM did it — a closure nobody can account for is worse than none.
    const auto = (await stream(ticket.id)).find(
      (e) => e.type === 'statusChanged' && e.toStatus === 'closed',
    );
    expect(auto?.actorUserId).toBeNull();
    expect(auto?.metadata.autoClosed).toBe(true);
  });

  it('leaves a recently resolved ticket alone', async () => {
    const ticket = await workingTicket();
    await act(ticket.id, 'resolve', { summary: 'done' });
    await ticketAutoCloseSweep();
    expect((await getTicket(ticket.id)).status).toBe('resolved');
  });

  // `0` is the honest way to express "we do not auto-close", rather than a magic large number.
  it('does nothing at all when the window is set to 0', async () => {
    const ticket = await workingTicket();
    await act(ticket.id, 'resolve', { summary: 'done' });
    await backdateResolution(ticket.id, 30);

    const setAutoClose = async (value: number): Promise<void> => {
      const res = await request(app)
        .patch('/api/v1/platform/settings/values')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ key: ItSettingKeys.TicketAutoCloseDays, scope: 'organization', value });
      // The settings write answers 204 — it returns no body.
      expect(res.status).toBe(204);
    };
    const before = await settingsService.resolve<number>(ItSettingKeys.TicketAutoCloseDays, {
      userId: null,
      branchId: null,
    });

    await setAutoClose(0);
    const result = await ticketAutoCloseSweep();
    expect(result.closed).toBe(0);
    expect((await getTicket(ticket.id)).status).toBe('resolved');

    // Put it back, so the ordering of the suites cannot matter.
    await setAutoClose(typeof before === 'number' && before > 0 ? before : 7);
  });
});

// ── The stream ──────────────────────────────────────────────────────────────

describe('the ticket stream', () => {
  it('is ONE list carrying both the history and the conversation, newest first', async () => {
    const ticket = await openTicket(requesterToken);
    await act(ticket.id, 'assign', { technicianUserId: techUserId });
    await request(app)
      .post(`/api/v1/it/tickets/${ticket.id}/comments`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ body: 'looking at it now' });
    await act(ticket.id, 'resolve', { summary: 'cleaned the rollers' });

    const entries = await stream(ticket.id);
    const types = entries.map((e) => e.type);
    for (const type of ['opened', 'assigned', 'statusChanged', 'commented']) {
      expect(types, `${type} missing from the stream`).toContain(type);
    }
    // Newest first — a stream is a chronology, not a sortable table.
    const times = entries.map((e) => new Date(e.at).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('carries the status move in TYPED columns, not buried in metadata', async () => {
    const ticket = await workingTicket();
    const row = (await stream(ticket.id)).find((e) => e.type === 'statusChanged');
    expect(row?.fromStatus).toBe('open');
    expect(row?.toStatus).toBe('inProgress');
  });

  it('filters by type', async () => {
    const ticket = await workingTicket();
    const res = await request(app)
      .get(`/api/v1/it/tickets/${ticket.id}/comments?type=opened`)
      .set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(200);
    const entries = data<ItTicketEventDto[]>(res);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.type).toBe('opened');
  });

  it('obeys the ticket’s own scope — no stream for a ticket you cannot see', async () => {
    const theirs = await openTicket(otherRequesterToken);
    const res = await request(app)
      .get(`/api/v1/it/tickets/${theirs.id}/comments`)
      .set('Authorization', `Bearer ${requesterToken}`);
    expect(res.status).toBe(404);
  });
});

// ── The queue ───────────────────────────────────────────────────────────────

describe('the ticket queue', () => {
  it('filters by status, by lifecycle, and searches code/title/description', async () => {
    const ticket = await openTicket(requesterToken, {
      title: 'Projector bulb has blown',
      description: 'Meeting room 3 projector shows nothing.',
    });

    const byStatus = await request(app)
      .get('/api/v1/it/tickets?status=open&pageSize=100')
      .set('Authorization', `Bearer ${techToken}`);
    expect(data<ItTicketDto[]>(byStatus).every((t) => t.status === 'open')).toBe(true);

    const active = await request(app)
      .get('/api/v1/it/tickets?active=true&pageSize=100')
      .set('Authorization', `Bearer ${techToken}`);
    expect(
      data<ItTicketDto[]>(active).every((t) =>
        ['open', 'inProgress', 'onHold'].includes(t.status),
      ),
    ).toBe(true);

    for (const term of ['Projector', 'Meeting room 3', ticket.ticketCode]) {
      const res = await request(app)
        .get(`/api/v1/it/tickets?search=${encodeURIComponent(term)}&pageSize=100`)
        .set('Authorization', `Bearer ${techToken}`);
      expect(res.status).toBe(200);
      expect(data<ItTicketDto[]>(res).map((t) => t.id), `search "${term}"`).toContain(ticket.id);
    }
  });

  it('combines the breached filter with a search instead of losing one of them', async () => {
    const res = await request(app)
      .get('/api/v1/it/tickets?breached=true&search=printer&pageSize=100')
      .set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(200);
    // Every row must satisfy BOTH — a widened result set would mean one filter was dropped.
    for (const ticket of data<ItTicketDto[]>(res)) {
      const breached =
        ticket.sla.responseBreachedAt !== null || ticket.sla.resolutionBreachedAt !== null;
      expect(breached).toBe(true);
      const haystack = `${ticket.ticketCode} ${ticket.title} ${ticket.description}`.toLowerCase();
      expect(haystack).toContain('printer');
    }
  });

  // The declared sort fields are honoured; an undeclared one FALLS BACK to `createdAt` rather
  // than erroring — which is why the queue's headers offer only the declared four. A header
  // wired to `title` would not 400, it would silently sort by something else, and nobody would
  // notice that the column they clicked did nothing.
  it('sorts by the fields it declares, and quietly ignores any other', async () => {
    const codes = async (query: string): Promise<string[]> => {
      const res = await request(app)
        .get(`/api/v1/it/tickets?pageSize=100&${query}`)
        .set('Authorization', `Bearer ${techToken}`);
      expect(res.status).toBe(200);
      return data<ItTicketDto[]>(res).map((t) => t.ticketCode);
    };
    const ascending = await codes('sortBy=ticketCode&sortDir=asc');
    expect([...ascending].sort()).toEqual(ascending);
    const descending = await codes('sortBy=ticketCode&sortDir=desc');
    expect(descending).toEqual([...ascending].reverse());
    // An undeclared field is IGNORED and `createdAt` is used instead — asserted by showing the
    // two answers are identical. (Comparing it against the ticketCode order would prove nothing
    // here: these tickets were created in code order, so the two orderings coincide.)
    expect(await codes('sortBy=title&sortDir=asc')).toEqual(
      await codes('sortBy=createdAt&sortDir=asc'),
    );
  });

  it('refuses the queue to someone with no ticket grant', async () => {
    const res = await request(app)
      .get('/api/v1/it/tickets')
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(res.status).toBe(403);
  });
});
