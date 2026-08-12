// Regression: the seed ↔ login contract. Every seeded account is privileged, and TOTP is
// enforced for privileged accounts by default — so without the seed's dev-login convenience a
// fresh `npm run seed` would leave you unable to log in with email/password. This exercises the
// REAL seed path (`seedDevData`, imported — not a copy) and asserts a plain password login yields
// a token and a working /me. If the seed's enforcement-disable is ever removed, this fails.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SettingKeys, type MeDto } from '@ecms/contracts';
import { type Express } from 'express';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { env } from '../../src/infrastructure/config/env';
import { seedDevData } from '../../src/seed-data';
import { seedApplicationSections } from '../../src/seed-application-sections';
import { settingsService } from '../../src/platform/settings';
import { getCache } from '../../src/infrastructure/redis/cache';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';

let replSet: MongoMemoryReplSet | null = null;
let app: Express;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-seedlogin-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

interface LoginBody {
  success: boolean;
  data?: { totpRequired: boolean; accessToken?: string; me?: MeDto };
}

const doLogin = async (email: string, password: string) => {
  await getCache().delByPrefix('rl:'); // keep strict auth rate-limits out of the way
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  const setCookie = res.headers['set-cookie'];
  const cookie =
    setCookie === undefined
      ? null
      : ([setCookie].flat().find((c: string) => c.startsWith('ecms_refresh=')) ?? null);
  return { status: res.status, body: res.body as LoginBody, cookie };
};

beforeAll(async () => {
  // WITH THE MODULE MANIFESTS, exactly as `seed.ts` boots before calling `seedDevData` — this
  // suite's whole claim is that it exercises the real seed path, and the boot is half of it.
  //
  // Booting without them used to look equivalent because navigation was not permission-filtered:
  // the sidebar came back complete whether or not the caller could open anything in it. It is
  // filtered now, and a module-less boot registers only the platform permissions — so `super-admin`
  // (whose grants track the registry) genuinely held nothing in HR, Fleet or IT, and the assertion
  // below started failing on a sidebar that was correct for that boot and wrong for a real seed.
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();
  await seedDevData(); // the real seed — no external enforcement toggle
}, 180_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('seed → password login (regression)', () => {
  it('the seed disables TOTP enforcement for privileged accounts at organization scope', async () => {
    const enforced = await settingsService.resolve<boolean>(SettingKeys.TotpEnforcedForPrivileged, {
      userId: null,
      branchId: null,
    });
    expect(enforced).toBe(false);
  });

  it('the seeded admin logs in with email/password and gets a token + working /me', async () => {
    const result = await doLogin(env.SEED_ADMIN_EMAIL, env.SEED_ADMIN_PASSWORD);
    expect(result.status).toBe(200);
    expect(result.body.data?.totpRequired).toBe(false);
    const token = result.body.data?.accessToken ?? '';
    expect(token).toBeTruthy();
    expect(result.cookie).toContain('HttpOnly');

    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    const permissions = (me.body as { data: MeDto }).data.permissions;
    expect(permissions['user.view']).toBe('organization');
    // MODULE permissions too, straight out of a first run. The seed used to grant this role the
    // platform catalog alone, so on a fresh database the administrator could not open a single
    // module screen until the next API start widened the role — invisible while navigation was
    // unfiltered, and the reason the sidebar assertion below is worth having.
    expect(permissions['applicant.view'], 'HR').toBe('organization');
    expect(permissions['fleetVehicle.view'], 'Fleet').toBe('organization');
    expect(permissions['itAsset.view'], 'IT').toBe('organization');
  });

  it('the seeded admin has a functional data-driven sidebar out of the box (first-run bootstrap)', async () => {
    const login = await doLogin(env.SEED_ADMIN_EMAIL, env.SEED_ADMIN_PASSWORD);
    const token = login.body.data?.accessToken ?? '';
    const res = await request(app)
      .get('/api/v1/platform/me/applications')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const groups = (
      res.body as {
        data: {
          name: { en: string };
          applications: { route: string }[];
          sections: { applications: { route: string }[] }[];
        }[];
      }
    ).data;

    // Default categories are seeded and returned in sortOrder. IT joins at 25 — between
    // Organization (20) and Administration (30) — now that ITW-1 has given it application rows;
    // IT-1 seeded the category deliberately empty, and an empty category is not returned.
    expect(groups.map((g) => g.name.en)).toEqual([
      'HR',
      'Fleet',
      'Organization',
      'IT',
      'Administration',
    ]);
    // Applications map to the app's real client routes, granted directly to the admin.
    // Every page of every module — grouped or not. The default sections moved most of HR into
    // groups, and a page inside one is still a page the sidebar shows.
    const routes = groups.flatMap((g) =>
      [...g.applications, ...g.sections.flatMap((s) => s.applications)].map((a) => a.route),
    );
    expect(routes).toContain('/applicants');
    expect(routes).toContain('/leave');
    expect(routes).toContain('/fleet');
    expect(routes).toContain('/fleet/vehicles');
    expect(routes).toContain('/organization/branches');
    expect(routes).toContain('/organization/applications');
    expect(routes).toContain('/contracts');
    // The three admin pages that were routed but unlisted until they were given catalog rows.
    expect(routes).toContain('/recruitment-form');
    expect(routes).toContain('/interviews/stages');
    expect(routes).toContain('/evaluations/phases');
    expect(routes).toContain('/applicant-sources');
    // ITW-1's five rows — the asset registry surface — plus IT-2's custody register, IT-3's help
    // desk, IT-4's maintenance and store, and IT-5's software register. The nav sync is additive,
    // so each slice appends its own rows here as it lands.
    expect(routes).toContain('/it');
    expect(routes).toContain('/it/assets');
    expect(routes).toContain('/it/assets/scan');
    expect(routes).toContain('/it/vendors');
    expect(routes).toContain('/it/catalogs');
    expect(routes).toContain('/it/custody');
    expect(routes).toContain('/it/tickets');
    expect(routes).toContain('/it/helpdesk-settings');
    expect(routes).toContain('/it/maintenance');
    expect(routes).toContain('/it/maintenance-plans');
    expect(routes).toContain('/it/spare-parts');
    expect(routes).toContain('/it/software');
    expect(routes).toContain('/it/licenses');
    // SA-1 appends the System Administration users screen to the Administration group; SA-3 adds
    // the roles and permission-registry screens beside it; P8 adds system settings; P10 adds the
    // notification-template catalog; P11 adds the two log streams; Attendance AT-1 adds the two
    // shift-administration screens to the HR group.
    expect(routes).toContain('/system/users');
    expect(routes).toContain('/system/roles');
    expect(routes).toContain('/system/permissions');
    expect(routes).toContain('/system/settings');
    expect(routes).toContain('/system/notification-templates');
    expect(routes).toContain('/system/audit');
    expect(routes).toContain('/system/activity');
    expect(routes).toContain('/attendance/shifts');
    expect(routes).toContain('/attendance/assignments');
    expect(routes).toContain('/attendance/daily');
    expect(routes).toContain('/attendance/regularizations');
    // 18 (HR) + 12 (Fleet) + 6 (Organization) + 13 (IT) + 9 (Administration)
    expect(routes).toHaveLength(58);
  });

  it('re-running the seed is idempotent — no duplicate categories/applications/grants', async () => {
    await seedDevData();
    const login = await doLogin(env.SEED_ADMIN_EMAIL, env.SEED_ADMIN_PASSWORD);
    const token = login.body.data?.accessToken ?? '';
    const res = await request(app)
      .get('/api/v1/platform/me/applications')
      .set('Authorization', `Bearer ${token}`);
    const groups = (
      res.body as {
        data: { applications: unknown[]; sections: { applications: unknown[] }[] }[];
      }
    ).data;
    expect(groups).toHaveLength(5);
    // Counted across sections too: re-seeding must not duplicate a row, wherever it is grouped.
    expect(
      groups.reduce(
        (n, g) => n + g.applications.length + g.sections.reduce((m, s) => m + s.applications.length, 0),
        0,
      ),
    ).toBe(58);
  });

  it('the seeded HR user also logs in with email/password', async () => {
    const result = await doLogin(env.SEED_HR_EMAIL, env.SEED_HR_PASSWORD);
    expect(result.status).toBe(200);
    expect(result.body.data?.totpRequired).toBe(false);
    expect(result.body.data?.accessToken).toBeTruthy();
  });

  it('rejects a wrong password with a stable error code', async () => {
    const result = await doLogin(env.SEED_ADMIN_EMAIL, 'Definitely#Wrong1');
    expect(result.status).toBe(401);
  });

  // The navigation shell is a personal preference: it must survive on the account, answer with a
  // default for accounts that predate it, and refuse anything outside the two known shells.
  describe('navigation preference (self-service)', () => {
    const patch = async (token: string, body: Record<string, unknown>) =>
      request(app)
        .patch('/api/v1/auth/me/preferences')
        .set('Authorization', `Bearer ${token}`)
        .send(body);

    it('defaults to the launchpad, persists a change, and survives a fresh /me', async () => {
      const token = (await doLogin(env.SEED_ADMIN_EMAIL, env.SEED_ADMIN_PASSWORD)).body.data
        ?.accessToken;
      expect(token).toBeTruthy();
      const before = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token ?? ''}`);
      expect((before.body as { data: MeDto }).data.navLayout).toBe('launchpad');

      const changed = await patch(token ?? '', { navLayout: 'rail' });
      expect(changed.status).toBe(200);
      // The response is the whole `me`, so the client never has to guess what else moved.
      expect((changed.body as { data: MeDto }).data.navLayout).toBe('rail');

      const after = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token ?? ''}`);
      expect((after.body as { data: MeDto }).data.navLayout).toBe('rail');

      // Put it back so the rest of the suite sees the shipped default.
      expect((await patch(token ?? '', { navLayout: 'launchpad' })).status).toBe(200);
    });

    it('rejects an unknown shell and refuses an unauthenticated caller', async () => {
      const token = (await doLogin(env.SEED_ADMIN_EMAIL, env.SEED_ADMIN_PASSWORD)).body.data
        ?.accessToken;
      expect((await patch(token ?? '', { navLayout: 'metro' })).status).toBe(400);
      expect((await patch(token ?? '', { navLayout: 'rail', isPrivileged: true })).status).toBe(400);
      expect(
        (await request(app).patch('/api/v1/auth/me/preferences').send({ navLayout: 'rail' })).status,
      ).toBe(401);
    });
  });
});

// ── Default application sections: additive, idempotent, never re-imposing ────
describe('the default sections migration', () => {
  const tokenOf = async (): Promise<string> => {
    const login = await doLogin(env.SEED_ADMIN_EMAIL, env.SEED_ADMIN_PASSWORD);
    return login.body.data?.accessToken ?? '';
  };
  const get = async (path: string, token: string) =>
    request(app).get(`/api/v1${path}`).set('Authorization', `Bearer ${token}`);

  const snapshot = async (token: string): Promise<string[]> => {
    const res = await get('/platform/applications?pageSize=100', token);
    return (res.body as { data: { id: string; sectionId: string | null }[] }).data
      .map((a) => `${a.id}:${a.sectionId ?? ''}`)
      .sort();
  };

  it('groups the seeded HR catalog, and re-running it changes nothing', async () => {
    const token = await tokenOf();

    // The seed already ran it once (seedDevData). The sections it names are there…
    const sections = await get('/platform/application-sections?pageSize=100', token);
    expect(sections.status).toBe(200);
    const named = (sections.body as { data: { name: { ar: string; en: string } }[] }).data;
    expect(named.map((s) => s.name.en)).toEqual(
      expect.arrayContaining(['Recruitment', 'Employee Management', 'Attendance & Leave']),
    );
    // …in both locales, like every other catalog row.
    expect(named.every((s) => s.name.ar.trim() !== '')).toBe(true);

    // …and the HR pages sit inside them rather than in a flat list.
    const grouped = (
      (await get('/platform/applications?pageSize=100', token)).body as {
        data: { route: string; sectionId: string | null }[];
      }
    ).data;
    expect(grouped.find((a) => a.route === '/applicants')?.sectionId).not.toBeNull();

    // Re-running is a no-op, to the id.
    const before = await snapshot(token);
    await seedApplicationSections(
      (await doLogin(env.SEED_ADMIN_EMAIL, env.SEED_ADMIN_PASSWORD)).body.data?.me?.id ?? '',
    );
    expect(await snapshot(token)).toEqual(before);
  });

  it('never re-groups a row an administrator has since taken out of a section', async () => {
    const token = await tokenOf();
    const adminId = (await doLogin(env.SEED_ADMIN_EMAIL, env.SEED_ADMIN_PASSWORD)).body.data?.me?.id ?? '';

    const applicants = (
      (await get('/platform/applications?pageSize=100', token)).body as {
        data: { id: string; route: string; categoryId: string; sectionId: string | null }[];
      }
    ).data.find((a) => a.route === '/applicants');
    expect(applicants?.sectionId).not.toBeNull();

    // Take it out of every section — a supported, ordinary end state.
    const ungrouped = await request(app)
      .patch('/api/v1/platform/applications/reorder')
      .set('Authorization', `Bearer ${token}`)
      .send({
        categoryId: applicants?.categoryId,
        sectionId: null,
        applicationIds: [applicants?.id],
      });
    expect(ungrouped.status).toBe(200);

    await seedApplicationSections(adminId);

    const reread = (
      (await get('/platform/applications?pageSize=100', token)).body as {
        data: { route: string; sectionId: string | null }[];
      }
    ).data.find((a) => a.route === '/applicants');
    // The migration fills a blank; it does not overrule a decision.
    expect(reread?.sectionId).toBeNull();

    // And the ungrouped row is still perfectly visible — directly under its module, which is
    // where a page with no section has always rendered.
    const nav = (
      (await get('/platform/me/applications', token)).body as {
        data: {
          applications: { route: string }[];
          sections: { applications: { route: string }[] }[];
        }[];
      }
    ).data;
    const routes = nav.flatMap((c) => [
      ...c.applications.map((a) => a.route),
      ...c.sections.flatMap((sec) => sec.applications.map((a) => a.route)),
    ]);
    expect(routes).toContain('/applicants');
    expect(nav.some((c) => c.applications.some((a) => a.route === '/applicants'))).toBe(true);
  });

});
