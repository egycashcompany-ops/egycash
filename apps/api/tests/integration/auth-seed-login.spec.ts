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
    //
    // B7 puts Operations at 17, so it lands between Fleet (15) and Organization (20). Its position
    // here IS the assertion that the sort order took effect: a category appended with a colliding
    // or absent order would surface at the end of this list rather than in the middle. The ported
    // Gold Vault module says the same at 27 — between IT (25) and Administration (30), and the
    // ported ATM module at 28 — between Gold Vault and Administration.
    expect(groups.map((g) => g.name.en)).toEqual([
      'HR',
      'Fleet',
      'Operations',
      'Organization',
      'IT',
      'Gold Vault',
      'ATM',
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
    expect(routes).toContain('/payroll/pay-items');
    expect(routes).toContain('/payroll/runs');
    // P-HR-06 adds the adjustments queue: the approval half of P-HR-04 had a permission, an
    // organization-wide endpoint and a declared page, but no row in anybody's sidebar.
    expect(routes).toContain('/payroll/adjustments');
    // P-HR-06-B adds the loans administration: phase A declared `employeeLoan.*` with no page at
    // all, because the only surface was a tab on one employee's file.
    expect(routes).toContain('/payroll/employee-loans');
    // P-HR-23 adds the cost centres catalog to Organization — the axis payroll cost is reported
    // along, which needed a sidebar row of its own rather than a corner of another screen.
    expect(routes).toContain('/organization/cost-centers');
    // B7 — the thirteen Operations rows. B1-B6 shipped the screens routed, permission-gated and
    // API-connected but appended NOTHING here, so the module was reachable only by typing a URL.
    // The module home is asserted too: without it there is no entry point to the module at all.
    expect(routes).toContain('/operations');
    expect(routes).toContain('/operations/shipments');
    expect(routes).toContain('/operations/crew-board');
    expect(routes).toContain('/operations/requirements');
    expect(routes).toContain('/operations/attendance');
    expect(routes).toContain('/operations/secured');
    expect(routes).toContain('/operations/vault/receive');
    expect(routes).toContain('/operations/vault/dispatch');
    expect(routes).toContain('/operations/vault');
    expect(routes).toContain('/operations/reports/vault');
    expect(routes).toContain('/operations/reports/captains');
    expect(routes).toContain('/operations/reports/banks');
    expect(routes).toContain('/operations/catalogs');
    // الطاقم الثابت — the permanent crew each day's board is seeded from.
    expect(routes).toContain('/operations/standing-crew');
    // The ported gold sidebar, screen for screen.
    expect(routes).toContain('/gold');
    expect(routes).toContain('/gold/vaults');
    expect(routes).toContain('/gold/vault-settings');
    expect(routes).toContain('/gold/bars');
    expect(routes).toContain('/gold/receiving');
    expect(routes).toContain('/gold/delivery');
    expect(routes).toContain('/gold/transfers');
    expect(routes).toContain('/gold/keys');
    expect(routes).toContain('/gold/companies');
    expect(routes).toContain('/gold/representatives');
    expect(routes).toContain('/gold/reports');
    expect(routes).toContain('/gold/portal-accounts');
    // The ported ATM sidebar, screen for screen against the legacy standalone system.
    expect(routes).toContain('/atm');
    expect(routes).toContain('/atm/replenishments');
    expect(routes).toContain('/atm/replenishments/done');
    expect(routes).toContain('/atm/maintenance');
    expect(routes).toContain('/atm/maintenance/done');
    expect(routes).toContain('/atm/mail-tickets');
    expect(routes).toContain('/atm/mail-tickets/log');
    expect(routes).toContain('/atm/machines');
    expect(routes).toContain('/atm/reports/daily');
    expect(routes).toContain('/atm/data-edit');
    // 22 (HR) + 12 (Fleet) + 14 (Operations) + 6 (Organization) + 13 (IT) + 12 (Gold Vault)
    //   + 9 (Administration) + 10 (ATM)
    expect(routes).toHaveLength(100); // +1: C1 Captain's Day, +1: the standing crew
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
    // B7 added Operations beside HR, Fleet, Organization, IT and Admin; the gold port adds a
    // seventh and the ATM port an eighth.
    expect(groups).toHaveLength(8);
    // Counted across sections too: re-seeding must not duplicate a row, wherever it is grouped.
    expect(
      groups.reduce(
        (n, g) =>
          n + g.applications.length + g.sections.reduce((m, s) => m + s.applications.length, 0),
        0,
      ),
    ).toBe(100); // +1: C1 Captain's Day, +1: the standing crew, +12: gold, +10: ATM
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
      expect((await patch(token ?? '', { navLayout: 'rail', isPrivileged: true })).status).toBe(
        400,
      );
      expect(
        (await request(app).patch('/api/v1/auth/me/preferences').send({ navLayout: 'rail' }))
          .status,
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

  /**
   * The WHOLE application catalog, not the first page of it. The catalog outgrew a single page
   * when the ATM module landed: MAX_PAGE_SIZE is 100 and the seeded catalog is now 101 rows, so a
   * lone `pageSize=100` read silently drops the OLDEST row under the default `createdAt: -1`
   * sort — and that row is `/applicants`, which is exactly the page these tests move between
   * sections. Page through, so the assertions keep seeing the catalog rather than a prefix of it.
   */
  const allApplications = async <T>(token: string): Promise<T[]> => {
    const first = await get('/platform/applications?pageSize=100', token);
    const head = first.body as { data: T[]; meta: { totalPages: number } };
    const out = [...head.data];
    for (let page = 2; page <= head.meta.totalPages; page += 1) {
      const next = await get(`/platform/applications?pageSize=100&page=${String(page)}`, token);
      out.push(...(next.body as { data: T[] }).data);
    }
    return out;
  };

  const snapshot = async (token: string): Promise<string[]> => {
    const rows = await allApplications<{ id: string; sectionId: string | null }>(token);
    return rows.map((a) => `${a.id}:${a.sectionId ?? ''}`).sort();
  };

  it('groups the seeded HR catalog, and re-running it changes nothing', async () => {
    const token = await tokenOf();

    // The seed already ran it once (seedDevData). The sections it names are there…
    const sections = await get('/platform/application-sections?pageSize=100', token);
    expect(sections.status).toBe(200);
    const named = (sections.body as { data: { name: { ar: string; en: string } }[] }).data;
    // The HR groups follow the employee lifecycle: a candidate (Recruitment), the person once
    // hired (Employees), the record that follows them (Employee File), and what that record
    // produces month to month (Attendance & Leave, Payroll).
    expect(named.map((s) => s.name.en)).toEqual(
      expect.arrayContaining([
        'Recruitment',
        'Employees',
        'Employee File',
        'Attendance & Leave',
        'Payroll',
      ]),
    );
    // …in both locales, like every other catalog row.
    expect(named.every((s) => s.name.ar.trim() !== '')).toBe(true);

    // …and the HR pages sit inside them rather than in a flat list.
    const grouped = await allApplications<{ route: string; sectionId: string | null }>(token);
    expect(grouped.find((a) => a.route === '/applicants')?.sectionId).not.toBeNull();

    // Re-running is a no-op, to the id.
    const before = await snapshot(token);
    await seedApplicationSections(
      (await doLogin(env.SEED_ADMIN_EMAIL, env.SEED_ADMIN_PASSWORD)).body.data?.me?.id ?? '',
    );
    expect(await snapshot(token)).toEqual(before);
  });

  /**
   * What "an administrator's decision" means now, and what it no longer means.
   *
   * A row in NO group looks identical whether nobody ever filed it or somebody took it out, so a
   * rule that adopts the first necessarily adopts the second — and adopting the first is what
   * stops a page from silently going missing every time a release adds one (see the case below).
   *
   * So the promise is narrower and sharper than it was: a page moved to a DIFFERENT group is left
   * exactly where the administrator put it. That is a decision the data can actually express, and
   * it is also the way to make an unwanted grouping stick.
   */
  it('leaves a row an administrator moved to another group exactly where they put it', async () => {
    const token = await tokenOf();
    const adminId =
      (await doLogin(env.SEED_ADMIN_EMAIL, env.SEED_ADMIN_PASSWORD)).body.data?.me?.id ?? '';

    const apps = await allApplications<{
      id: string;
      route: string;
      categoryId: string;
      sectionId: string | null;
    }>(token);
    const sections = (
      (await get('/platform/application-sections?pageSize=100', token)).body as {
        data: { id: string; name: { en: string } }[];
      }
    ).data;

    // `/applicants` belongs to Recruitment by default. Move it to Payroll — a deliberate,
    // supported choice, and a grouping this file would never write.
    const applicants = apps.find((a) => a.route === '/applicants');
    const payroll = sections.find((x) => x.name.en === 'Payroll');
    expect(applicants?.sectionId).not.toBe(payroll?.id);
    const moved = await request(app)
      .patch('/api/v1/platform/applications/reorder')
      .set('Authorization', `Bearer ${token}`)
      .send({
        categoryId: applicants?.categoryId,
        sectionId: payroll?.id,
        applicationIds: [applicants?.id],
      });
    expect(moved.status).toBe(200);

    await seedApplicationSections(adminId);

    const reread = (await allApplications<{ route: string; sectionId: string | null }>(token)).find(
      (a) => a.route === '/applicants',
    );
    // Recruitment names this page. It does not take it back.
    expect(reread?.sectionId).toBe(payroll?.id);
  });

  /**
   * THE REGRESSION THIS FIX EXISTS FOR — a page added to a group that already existed.
   *
   * `Payroll` shipped in PY-1 (d42c559) holding `/payroll/pay-items`. PY-6 (b70e462) added
   * `/payroll/runs` to the same list, and the old rule skipped a section it had already created,
   * so the new page was never filed: it rendered flat, above the groups, release after release.
   *
   * The state below is exactly that: the section is there with its first page in it, and the page
   * added later is in no group at all.
   */
  it('files a page added later to a section that already existed', async () => {
    const token = await tokenOf();
    const adminId =
      (await doLogin(env.SEED_ADMIN_EMAIL, env.SEED_ADMIN_PASSWORD)).body.data?.me?.id ?? '';

    const appsOf = async (): Promise<
      { id: string; route: string; categoryId: string; sectionId: string | null }[]
    > =>
      await allApplications<{
        id: string;
        route: string;
        categoryId: string;
        sectionId: string | null;
      }>(token);
    const sectionsOf = async (): Promise<{ id: string; name: { en: string } }[]> =>
      (
        (await get('/platform/application-sections?pageSize=100', token)).body as {
          data: { id: string; name: { en: string } }[];
        }
      ).data;

    const payroll = (await sectionsOf()).find((x) => x.name.en === 'Payroll');
    expect(payroll, 'the Payroll section exists').toBeDefined();

    // Put `/payroll/runs` back in the state PY-6 left it in — entitled, visible, ungrouped —
    // while `/payroll/pay-items` stays where PY-1 filed it.
    const runs = (await appsOf()).find((a) => a.route === '/payroll/runs');
    const ungrouped = await request(app)
      .patch('/api/v1/platform/applications/reorder')
      .set('Authorization', `Bearer ${token}`)
      .send({ categoryId: runs?.categoryId, sectionId: null, applicationIds: [runs?.id] });
    expect(ungrouped.status).toBe(200);

    const before = await appsOf();
    expect(before.find((a) => a.route === '/payroll/runs')?.sectionId).toBeNull();
    expect(before.find((a) => a.route === '/payroll/pay-items')?.sectionId).toBe(payroll?.id);

    await seedApplicationSections(adminId);

    // The page the release added is now in the group that names it…
    const after = await appsOf();
    expect(after.find((a) => a.route === '/payroll/runs')?.sectionId).toBe(payroll?.id);
    // …and the one that was already there was not disturbed on the way.
    expect(after.find((a) => a.route === '/payroll/pay-items')?.sectionId).toBe(payroll?.id);

    // No page is claimed by two groups: `sectionId` holds one value, so filing moves rather than
    // copies — asserted over the whole catalog, not just the two rows above.
    const grouped = after.filter((a) => a.sectionId !== null).map((a) => a.route);
    expect(new Set(grouped).size).toBe(grouped.length);

    // And running it again writes nothing further.
    const settled = await appsOf();
    await seedApplicationSections(adminId);
    expect(await appsOf()).toEqual(settled);
  });

  /**
   * The lifecycle split, over HTTP: the two halves land in the right groups and the pages the
   * sidebar shows are exactly the pages that existed before.
   *
   * Read through `/platform/me/applications` rather than the raw rows, because that is what the
   * sidebar renders — a row grouped in the database but dropped from this payload would be a page
   * that vanished from the navigation, which is the failure this whole change must not cause.
   */
  it('files the employee pages by lifecycle, and loses none of them', async () => {
    const token = await tokenOf();
    const nav = (
      (await get('/platform/me/applications', token)).body as {
        data: {
          name: { en: string };
          applications: { route: string }[];
          sections: { name: { en: string }; applications: { route: string }[] }[];
        }[];
      }
    ).data;
    const hr = nav.find((c) => c.name.en === 'HR');
    expect(hr).toBeDefined();

    const inSection = (en: string): string[] =>
      hr?.sections.find((s) => s.name.en === en)?.applications.map((a) => a.route) ?? [];

    // The person, and the last step of hiring them — its own service says the document set is
    // collected AFTER the employee exists.
    expect(inSection('Employees')).toEqual(['/employees', '/hiring-documents']);
    // The record that follows them.
    expect(inSection('Employee File')).toEqual(['/employee-files', '/contracts']);
    // And the group they were all in before is gone from the payload — empty sections are
    // omitted, so the split leaves no heading over nothing.
    expect(hr?.sections.map((s) => s.name.en)).not.toContain('Employee Management');

    // Nothing was dropped on the way: every page still appears exactly once, somewhere.
    const shown = [
      ...(hr?.applications.map((a) => a.route) ?? []),
      ...(hr?.sections.flatMap((s) => s.applications.map((a) => a.route)) ?? []),
    ];
    for (const route of ['/applicants', '/employees', '/contracts', '/leave', '/payroll/runs']) {
      expect(
        shown.filter((r) => r === route),
        route,
      ).toEqual([route]);
    }
  });
});
