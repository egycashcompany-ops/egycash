// The transport proven end to end (ADR-029), on a REAL Socket.IO server and real clients over a
// real port — no database anywhere. Auth is the one seam faked: the middleware here stores the
// AuthContext exactly the way `notification.socket.ts` contracts to, and everything after that —
// room derivation, joining, publishing, delivery and NON-delivery — is the production code path.
import { createServer, type Server as HttpServer } from 'node:http';
import { io as connectClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENTITY_CHANGED_EVENT, type EntityChangedPayload } from '@ecms/contracts';
import { closeSocketServer, initSocketServer } from '../../infrastructure/realtime/socket-server';
import { type AuthContext } from '../../shared/types';
import { publishAuditedChange } from './realtime-publisher';
import { attachRealtimeSocket } from './realtime.socket';

const ctxOf = (over: Partial<AuthContext>): AuthContext => ({
  userId: 'u1',
  sessionId: 's1',
  branchId: null,
  departmentId: null,
  sectionId: null,
  locale: 'en',
  permissions: {},
  permissionVersion: 1,
  isPrivileged: false,
  ...over,
});

let httpServer: HttpServer;
let baseUrl = '';
const clients: ClientSocket[] = [];

const connectAs = async (ctx: AuthContext): Promise<ClientSocket> => {
  const socket = connectClient(baseUrl, {
    auth: { ctx },
    transports: ['websocket'],
    reconnection: false,
  });
  clients.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.on('connect', () => resolve());
    socket.on('connect_error', (error) => reject(error));
  });
  return socket;
};

const nextChange = (socket: ClientSocket, ms = 1500): Promise<EntityChangedPayload> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no entity.changed arrived')), ms);
    socket.once(ENTITY_CHANGED_EVENT, (payload: EntityChangedPayload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

/** Proves NON-delivery: the socket hears nothing for a grace window after the publish. */
const expectSilence = async (socket: ClientSocket, ms = 400): Promise<void> => {
  let heard: EntityChangedPayload | null = null;
  const listener = (payload: EntityChangedPayload): void => {
    heard = payload;
  };
  socket.on(ENTITY_CHANGED_EVENT, listener);
  await new Promise((resolve) => setTimeout(resolve, ms));
  socket.off(ENTITY_CHANGED_EVENT, listener);
  expect(heard).toBeNull();
};

beforeAll(async () => {
  httpServer = createServer();
  const io = initSocketServer(httpServer);
  // The auth seam: exactly the contract notification.socket's middleware fulfils in production.
  io.use((socket, next) => {
    const ctx = (socket.handshake.auth as { ctx?: AuthContext }).ctx;
    if (ctx === undefined) {
      next(new Error('unauthenticated'));
      return;
    }
    (socket.data as { authContext?: AuthContext }).authContext = ctx;
    next();
  });
  attachRealtimeSocket(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  for (const client of clients) client.disconnect();
  await closeSocketServer();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

describe('realtime over a real socket', () => {
  it('delivers a create to an organization-scope viewer, in the minimal shape', async () => {
    const socket = await connectAs(
      ctxOf({ userId: 'org-hr', permissions: { 'employee.view': 'organization' } }),
    );
    const arriving = nextChange(socket);
    publishAuditedChange({
      entityRef: { moduleId: 'hr', entityType: 'employee', entityId: 'e77' },
      action: 'create',
      at: '2026-08-25T10:00:00.000Z',
    });
    expect(await arriving).toEqual({
      module: 'hr',
      entity: 'employee',
      entityId: 'e77',
      action: 'create',
      at: '2026-08-25T10:00:00.000Z',
    });
    socket.disconnect();
  });

  it('delivers a status transition the same way', async () => {
    const socket = await connectAs(
      ctxOf({ userId: 'ops', permissions: { 'operationsShipment.view': 'organization' } }),
    );
    const arriving = nextChange(socket);
    publishAuditedChange({
      entityRef: { moduleId: 'operations', entityType: 'shipment', entityId: 'sh9' },
      action: 'statusChange',
      at: '2026-08-25T11:00:00.000Z',
    });
    expect((await arriving).action).toBe('statusChange');
    socket.disconnect();
  });

  it('never crosses branches: branch A hears its change, branch B hears nothing', async () => {
    const scoped = (branch: string): AuthContext =>
      ctxOf({ userId: `user-${branch}`, branchId: branch, permissions: { 'goldBar.view': 'branch' } });
    const branchA = await connectAs(scoped('b1'));
    const branchB = await connectAs(scoped('b2'));
    const arriving = nextChange(branchA);
    publishAuditedChange({
      entityRef: { moduleId: 'gold', entityType: 'bar', entityId: 'bar5' },
      action: 'update',
      at: '2026-08-25T12:00:00.000Z',
      branchId: 'b1',
    });
    expect((await arriving).entityId).toBe('bar5');
    await expectSilence(branchB);
    branchA.disconnect();
    branchB.disconnect();
  });

  it('a branch-scoped viewer also stays silent on a change whose branch nobody named', async () => {
    const socket = await connectAs(
      ctxOf({ userId: 'b-only', branchId: 'b1', permissions: { 'goldBar.view': 'branch' } }),
    );
    publishAuditedChange({
      entityRef: { moduleId: 'gold', entityType: 'bar', entityId: 'bar6' },
      action: 'update',
      at: '2026-08-25T12:05:00.000Z',
    });
    await expectSilence(socket);
    socket.disconnect();
  });

  it('without the permission, not even the fact of a payroll change arrives', async () => {
    const without = await connectAs(
      ctxOf({ userId: 'plain', permissions: { 'employee.view': 'organization' } }),
    );
    const withPerm = await connectAs(
      ctxOf({ userId: 'payroll', permissions: { 'payrollRun.view': 'organization' } }),
    );
    const arriving = nextChange(withPerm);
    publishAuditedChange({
      entityRef: { moduleId: 'hr', entityType: 'payrollRun', entityId: 'run3' },
      action: 'statusChange',
      at: '2026-08-25T13:00:00.000Z',
    });
    expect((await arriving).entity).toBe('payrollRun');
    await expectSilence(without);
    without.disconnect();
    withPerm.disconnect();
  });

  it('an own-scope grant joins nothing — self-service screens do not get a branch-wide feed', async () => {
    const socket = await connectAs(
      ctxOf({ userId: 'self', branchId: 'b1', permissions: { 'employee.view': 'own' } }),
    );
    publishAuditedChange({
      entityRef: { moduleId: 'hr', entityType: 'employee', entityId: 'e1' },
      action: 'update',
      at: '2026-08-25T14:00:00.000Z',
      branchId: 'b1',
    });
    await expectSilence(socket);
    socket.disconnect();
  });
});
