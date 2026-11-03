// The heartbeat answers 204 to everyone it reaches, and writes only for staff.
//
// An external account is confined away from `/platform/presence` by `authenticate` already; this is
// the second lock, pinned here so a surface registered for customers or candidates later can never
// start counting their minutes on the page that describes the staff.
import { type Request, type Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type AuthContext } from '../../shared/types';

const presence = vi.hoisted(() => ({ recordHeartbeat: vi.fn(async () => undefined) }));
vi.mock('./presence.service', () => ({ presenceService: presence }));

const { heartbeat } = await import('./presence.controller');

/** `undefined` leaves the field out, as the synthetic contexts and older snapshots do. */
const context = (external: AuthContext['external'] | undefined): AuthContext => ({
  userId: 'u-1',
  sessionId: 's-1',
  branchId: null,
  departmentId: null,
  sectionId: null,
  locale: 'ar',
  permissions: {},
  permissionVersion: 1,
  isPrivileged: false,
  ...(external === undefined ? {} : { external }),
});

const call = async (ctx: AuthContext): Promise<{ status: number; ended: boolean }> => {
  const seen = { status: 0, ended: false };
  const res = {
    status: (code: number) => {
      seen.status = code;
      return res;
    },
    end: () => {
      seen.ended = true;
      return res;
    },
  } as unknown as Response;
  await heartbeat({ authContext: ctx } as unknown as Request, res);
  return seen;
};

beforeEach(() => presence.recordHeartbeat.mockClear());

describe('POST /platform/presence/heartbeat', () => {
  it('records the minute for a staff account and answers 204', async () => {
    expect(await call(context(null))).toEqual({ status: 204, ended: true });
    expect(presence.recordHeartbeat).toHaveBeenCalledWith('u-1');
  });

  it('treats a context with no external field (a staff snapshot) the same way', async () => {
    expect(await call(context(undefined))).toEqual({ status: 204, ended: true });
    expect(presence.recordHeartbeat).toHaveBeenCalledTimes(1);
  });

  it('answers 204 to an external account and writes nothing', async () => {
    const external = { moduleId: 'gold', subjectType: 'goldCompany', subjectId: 'c-1' };
    expect(await call(context(external))).toEqual({ status: 204, ended: true });
    expect(presence.recordHeartbeat).not.toHaveBeenCalled();
  });
});
