// IT-5 integration suite: the software register, its licences and the expiry sweep, over real HTTP
// with real RBAC.
//
// Six things here are worth more than the rest, because each is a rule that would be invisible if
// it silently broke:
//
//   1. **`seatsUsed` is derived** (FR-10). Proven by watching it MOVE as installs land and are
//      removed — never by reading a stored field, because there isn't one.
//   2. **A seat overrun warns and does not block** (§13-Q5). The install succeeds AND the event
//      fires. Either half alone would be the wrong behaviour.
//   3. **One product per asset while active** (§2.8), and removal frees both the slot and the seat.
//   4. **The sweep announces once per (fact, date)** and RE-ARMS on renewal — the property
//      ADR-025's key exists to give.
//   5. **`warnDays: 0`** silences the early warning and never the expiry.
//   6. **Permissions and scope** (§7): each grant proven necessary, and `itSoftware.manage` proven
//      not to widen which assets a caller can reach.
//
// Error mapping is asserted deliberately: 400 = the body could not be READ, 422 = it read fine but
// the domain refuses it, 409 = a conflict with state, 403 = the grant is missing, 404 = out of
// scope or absent.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  ItEvents,
  ItSettingKeys,
  SettingKeys,
  platformPermissions,
  type ItAssetDto,
  type ItCatalogItemDto,
  type ItLicenseDto,
  type ItSoftwareInstallationDto,
  type ItSoftwareProductDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { itPermissions } from '../../src/modules/it/it.module';
import { expirySweep } from '../../src/modules/it/shared/expiry-sweeps';
import { ItLicenseModel } from '../../src/modules/it/licenses/license.model';
import { ItAssetModel } from '../../src/modules/it/assets/asset.model';
import { subscribe } from '../../src/platform/kernel/event-bus';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
const DAY_MS = 86_400_000;

let replSet: MongoMemoryReplSet | null = null;
let app: Express;

let adminToken: string; // everything
let adminUserId: string; // for the direct settings writes below
let swToken: string; // itSoftware.view/manage + itLicense.view — the software administrator
let licToken: string; // itLicense.view/manage + itSoftware.view — the licence administrator
let readerToken: string; // both views, no manage — the negative control for every write
let branchSwToken: string; // itSoftware.* at BRANCH scope, placed in branch B
let outsiderToken: string; // no IT grant at all

let branchAId: string;
let branchBId: string;
let categoryId: string;
let vendorId: string;
const seenEvents: { name: string; payload: unknown }[] = [];

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-it-software-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const mkUser = async (email: string, branchId: string | null = null): Promise<string> => {
  const { user } = await userService.create(
    {
      email,
      firstName: { ar: 'م', en: 'T' },
      lastName: { ar: 'م', en: 'T' },
      locale: 'en',
      organization: { branchId, departmentId: null, sectionId: null, jobTitleId: null },
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

const eventsNamed = (name: string): { name: string; payload: unknown }[] =>
  seenEvents.filter((e) => e.name === name);

// ── HTTP helpers ────────────────────────────────────────────────────────────

const mkAsset = async (overrides: Record<string, unknown> = {}): Promise<ItAssetDto> => {
  const res = await request(app)
    .post('/api/v1/it/assets')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'ThinkPad T14', categoryId, branchId: branchAId, ...overrides });
  expect(res.status).toBe(201);
  return data<ItAssetDto>(res);
};

let productSeq = 0;
const mkProduct = async (
  overrides: Record<string, unknown> = {},
  token = swToken,
): Promise<ItSoftwareProductDto> => {
  productSeq += 1;
  const res = await request(app)
    .post('/api/v1/it/software-products')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: `Product ${String(productSeq)}`, ...overrides });
  expect(res.status).toBe(201);
  return data<ItSoftwareProductDto>(res);
};

const mkLicense = async (
  productId: string,
  overrides: Record<string, unknown> = {},
  token = licToken,
): Promise<ItLicenseDto> => {
  const res = await request(app)
    .post('/api/v1/it/licenses')
    .set('Authorization', `Bearer ${token}`)
    .send({ productId, ...overrides });
  expect(res.status).toBe(201);
  return data<ItLicenseDto>(res);
};

const getLicense = async (id: string, token = licToken): Promise<ItLicenseDto> => {
  const res = await request(app)
    .get(`/api/v1/it/licenses/${id}`)
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  return data<ItLicenseDto>(res);
};

const install = (
  body: Record<string, unknown>,
  token = swToken,
): request.Test =>
  request(app)
    .post('/api/v1/it/software-installations')
    .set('Authorization', `Bearer ${token}`)
    .send(body);

const mkInstall = async (
  body: Record<string, unknown>,
  token = swToken,
): Promise<ItSoftwareInstallationDto> => {
  const res = await install(body, token);
  expect(res.status).toBe(201);
  return data<ItSoftwareInstallationDto>(res);
};

const removeInstall = (id: string, token = swToken, body: Record<string, unknown> = {}) =>
  request(app)
    .post(`/api/v1/it/software-installations/${id}/remove`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

const setWarnDays = async (key: string, value: number): Promise<void> => {
  const ctx: AuthContext = {
    userId: adminUserId,
    sessionId: 'seed',
    branchId: null,
    departmentId: null,
    sectionId: null,
    locale: 'en',
    permissions: { 'setting.edit': 'organization' },
    permissionVersion: 1,
    isPrivileged: true,
  };
  await settingsService.set(ctx, { key, scope: 'organization', value });
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  for (const name of [
    ItEvents.LicenseExpiring,
    ItEvents.LicenseExpired,
    ItEvents.LicenseSeatsExceeded,
    ItEvents.AssetWarrantyExpiring,
    ItEvents.AssetWarrantyExpired,
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
  adminUserId = await mkUser('sw-admin@ecms.local');
  await rbacService.ensureAssignment(adminUserId, String(superAdmin._id), 'organization');

  const ctx: AuthContext = {
    userId: adminUserId,
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
  adminToken = await login('sw-admin@ecms.local');

  const mkRole = async (
    en: string,
    permissionKeys: string[],
    email: string,
    branchId: string | null = null,
    scope: 'organization' | 'branch' = 'organization',
  ): Promise<string> => {
    const role = await rbacService.createRole({ name: { en, ar: en }, permissionKeys }, adminUserId);
    const userId = await mkUser(email, branchId);
    await rbacService.ensureAssignment(userId, String(role._id), scope);
    return login(email);
  };

  swToken = await mkRole(
    'Software administrator',
    ['itSoftware.view', 'itSoftware.manage', 'itLicense.view'],
    'sw-admin2@ecms.local',
  );
  licToken = await mkRole(
    'Licence administrator',
    ['itLicense.view', 'itLicense.manage', 'itSoftware.view'],
    'sw-lic@ecms.local',
  );
  readerToken = await mkRole(
    'Software reader',
    ['itSoftware.view', 'itLicense.view'],
    'sw-reader@ecms.local',
  );
  outsiderToken = await mkRole('Outsider', ['user.view'], 'sw-outsider@ecms.local');

  const mkBranch = async (code: string, en: string): Promise<string> => {
    const res = await request(app)
      .post('/api/v1/platform/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code, name: { ar: en, en } });
    expect(res.status).toBe(201);
    return (res.body as { data: { id: string } }).data.id;
  };
  branchAId = await mkBranch('86', 'Software branch A');
  branchBId = await mkBranch('87', 'Software branch B');

  branchSwToken = await mkRole(
    'Branch software administrator',
    ['itSoftware.view', 'itSoftware.manage', 'itLicense.view'],
    'sw-branch@ecms.local',
    branchBId,
    'branch',
  );

  const category = await request(app)
    .post('/api/v1/it/catalog-items')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ kind: 'assetCategory', name: { ar: 'حواسيب', en: 'Laptops' } });
  expect(category.status).toBe(201);
  categoryId = data<ItCatalogItemDto>(category).id;

  const vendor = await request(app)
    .post('/api/v1/it/vendors')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'Software reseller' });
  expect(vendor.status).toBe(201);
  vendorId = (vendor.body as { data: { id: string } }).data.id;
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

// ── Products ────────────────────────────────────────────────────────────────

describe('software products', () => {
  it('deduplicates names — that is the catalogue\'s whole job (409)', async () => {
    const product = await mkProduct();
    const again = await request(app)
      .post('/api/v1/it/software-products')
      .set('Authorization', `Bearer ${swToken}`)
      .send({ name: product.name });
    expect(again.status).toBe(409);
  });

  it('takes a plain name, never a translated pair', async () => {
    const res = await request(app)
      .post('/api/v1/it/software-products')
      .set('Authorization', `Bearer ${swToken}`)
      .send({ name: { ar: 'أوفيس', en: 'Office' } });
    expect(res.status).toBe(400);
  });

  it('archives instead of deleting (FR-11), and an archived product takes no new install', async () => {
    const product = await mkProduct();
    const asset = await mkAsset();
    expect(
      (
        await request(app)
          .delete(`/api/v1/it/software-products/${product.id}`)
          .set('Authorization', `Bearer ${adminToken}`)
      ).status,
    ).toBe(404);

    const archived = await request(app)
      .patch(`/api/v1/it/software-products/${product.id}`)
      .set('Authorization', `Bearer ${swToken}`)
      .send({ active: false, version: product.version });
    expect(archived.status).toBe(200);
    expect((await install({ assetId: asset.id, productId: product.id })).status).toBe(422);
  });

  it('searches the server rather than being loaded (ADR-019 rule 5, §12)', async () => {
    const product = await mkProduct({ publisher: 'Contoso' });
    const res = await request(app)
      .get(`/api/v1/it/software-products?search=${encodeURIComponent(product.name)}`)
      .set('Authorization', `Bearer ${swToken}`);
    expect(res.status).toBe(200);
    expect(data<ItSoftwareProductDto[]>(res).map((p) => p.id)).toContain(product.id);
  });
});

// ── Installations ───────────────────────────────────────────────────────────

describe('software installations', () => {
  it('records an install and reads it back as active', async () => {
    const asset = await mkAsset();
    const product = await mkProduct();
    const row = await mkInstall({
      assetId: asset.id,
      productId: product.id,
      softwareVersion: '2021 LTSC',
    });
    expect(row.removedAt).toBeNull();
    expect(row.softwareVersion).toBe('2021 LTSC');
    // The optimistic-lock version is a NUMBER and separate from the software's version string.
    expect(typeof row.version).toBe('number');
  });

  // §2.8's invariant, and the reason it is a partial unique index rather than a check.
  it('allows one active install of a product per asset (409), and again after removal', async () => {
    const asset = await mkAsset();
    const product = await mkProduct();
    const first = await mkInstall({ assetId: asset.id, productId: product.id });
    expect((await install({ assetId: asset.id, productId: product.id })).status).toBe(409);

    expect((await removeInstall(first.id)).status).toBe(200);
    // The slot is free again — and the old row is still there.
    const second = await mkInstall({ assetId: asset.id, productId: product.id });
    expect(second.id).not.toBe(first.id);

    const history = await request(app)
      .get(`/api/v1/it/software-installations?assetId=${asset.id}&pageSize=50`)
      .set('Authorization', `Bearer ${swToken}`);
    expect(data<ItSoftwareInstallationDto[]>(history).length).toBe(2);
  });

  it('keeps the removed row and refuses to remove it twice', async () => {
    const asset = await mkAsset();
    const product = await mkProduct();
    const row = await mkInstall({ assetId: asset.id, productId: product.id });
    expect((await removeInstall(row.id)).status).toBe(200);
    expect((await removeInstall(row.id)).status).toBe(409);

    const read = await request(app)
      .get(`/api/v1/it/software-installations/${row.id}`)
      .set('Authorization', `Bearer ${swToken}`);
    expect(read.status).toBe(200);
    expect(data<ItSoftwareInstallationDto>(read).removedAt).not.toBeNull();
  });

  it('refuses a removal dated before the install', async () => {
    const asset = await mkAsset();
    const product = await mkProduct();
    const row = await mkInstall({ assetId: asset.id, productId: product.id });
    const res = await removeInstall(row.id, swToken, {
      removedAt: new Date(Date.now() - 10 * DAY_MS).toISOString(),
    });
    expect(res.status).toBe(422);
  });

  it('refuses a licence that belongs to another product (422)', async () => {
    const asset = await mkAsset();
    const [a, b] = [await mkProduct(), await mkProduct()];
    const license = await mkLicense(b.id, { seats: 5 });
    const res = await install({ assetId: asset.id, productId: a.id, licenseId: license.id });
    expect(res.status).toBe(422);
  });

  it('refuses an install on a disposed asset (FR-4)', async () => {
    const asset = await mkAsset();
    const product = await mkProduct();
    expect(
      (
        await request(app)
          .post(`/api/v1/it/assets/${asset.id}/dispose`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ method: 'scrapped', reason: 'old' })
      ).status,
    ).toBe(200);
    expect((await install({ assetId: asset.id, productId: product.id })).status).toBe(422);
  });

  it('never accepts a status or removedAt through PATCH', async () => {
    const asset = await mkAsset();
    const product = await mkProduct();
    const row = await mkInstall({ assetId: asset.id, productId: product.id });
    for (const body of [{ removedAt: null }, { assetId: asset.id }, { productId: product.id }]) {
      const res = await request(app)
        .patch(`/api/v1/it/software-installations/${row.id}`)
        .set('Authorization', `Bearer ${swToken}`)
        .send({ ...body, version: row.version });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });
});

// ── Seats: derived, and warn-only (FR-10, §13-Q5) ───────────────────────────

describe('licence seats', () => {
  it('derives seatsUsed from the live installations, in both directions', async () => {
    const product = await mkProduct();
    const license = await mkLicense(product.id, { seats: 10 });
    expect(license.seatsUsed).toBe(0);

    const rows: ItSoftwareInstallationDto[] = [];
    for (let i = 0; i < 3; i += 1) {
      const asset = await mkAsset();
      rows.push(await mkInstall({ assetId: asset.id, productId: product.id, licenseId: license.id }));
    }
    expect((await getLicense(license.id)).seatsUsed).toBe(3);

    // Removal frees the seat — the count is live, not a running total.
    expect((await removeInstall(rows[0]!.id)).status).toBe(200);
    expect((await getLicense(license.id)).seatsUsed).toBe(2);
  });

  it('reports an unlimited licence as never over seats', async () => {
    const product = await mkProduct();
    const license = await mkLicense(product.id);
    expect(license.seats).toBeNull();
    const asset = await mkAsset();
    await mkInstall({ assetId: asset.id, productId: product.id, licenseId: license.id });
    const after = await getLicense(license.id);
    expect(after.seatsUsed).toBe(1);
    expect(after.seats).toBeNull();
  });

  // FR-10 and §13-Q5 together: the install SUCCEEDS and the warning fires. Asserting only one half
  // would let the other regress silently.
  it('allows the overrun and announces it', async () => {
    const product = await mkProduct();
    const license = await mkLicense(product.id, { seats: 1 });
    const [a, b] = [await mkAsset(), await mkAsset()];
    await mkInstall({ assetId: a.id, productId: product.id, licenseId: license.id });

    const second = await install({ assetId: b.id, productId: product.id, licenseId: license.id });
    expect(second.status).toBe(201);
    expect((await getLicense(license.id)).seatsUsed).toBe(2);

    await waitFor(() =>
      eventsNamed(ItEvents.LicenseSeatsExceeded).some(
        (e) => (e.payload as { licenseId: string }).licenseId === license.id,
      ),
    );
    const event = eventsNamed(ItEvents.LicenseSeatsExceeded).find(
      (e) => (e.payload as { licenseId: string }).licenseId === license.id,
    );
    expect(event?.payload).toMatchObject({ seats: 1, seatsUsed: 2, productName: product.name });
  });

  it('does not warn while a licence is exactly full', async () => {
    const product = await mkProduct();
    const license = await mkLicense(product.id, { seats: 2 });
    for (let i = 0; i < 2; i += 1) {
      const asset = await mkAsset();
      await mkInstall({ assetId: asset.id, productId: product.id, licenseId: license.id });
    }
    expect((await getLicense(license.id)).seatsUsed).toBe(2);
    expect(
      eventsNamed(ItEvents.LicenseSeatsExceeded).some(
        (e) => (e.payload as { licenseId: string }).licenseId === license.id,
      ),
    ).toBe(false);
  });

  it('lists the installations behind the count', async () => {
    const product = await mkProduct();
    const license = await mkLicense(product.id, { seats: 5 });
    const asset = await mkAsset();
    await mkInstall({ assetId: asset.id, productId: product.id, licenseId: license.id });

    const res = await request(app)
      .get(`/api/v1/it/licenses/${license.id}/installations?active=true`)
      .set('Authorization', `Bearer ${swToken}`);
    expect(res.status).toBe(200);
    expect(data<ItSoftwareInstallationDto[]>(res).map((r) => r.assetId)).toContain(asset.id);
  });

  it('filters the compliance view on the derived numbers', async () => {
    const product = await mkProduct();
    const over = await mkLicense(product.id, { seats: 1 });
    const [a, b] = [await mkAsset(), await mkAsset()];
    await mkInstall({ assetId: a.id, productId: product.id, licenseId: over.id });
    await mkInstall({ assetId: b.id, productId: product.id, licenseId: over.id });

    const res = await request(app)
      .get('/api/v1/it/licenses?overSeats=true&pageSize=100')
      .set('Authorization', `Bearer ${licToken}`);
    expect(res.status).toBe(200);
    expect(data<ItLicenseDto[]>(res).map((l) => l.id)).toContain(over.id);
  });
});

// ── Licences ────────────────────────────────────────────────────────────────

describe('licences', () => {
  it('derives the state from the expiry date and stores none of it', async () => {
    const product = await mkProduct();
    const perpetual = await mkLicense(product.id);
    expect(perpetual.state).toBe('perpetual');

    const active = await mkLicense(product.id, {
      expiresAt: new Date(Date.now() + 200 * DAY_MS).toISOString(),
    });
    expect(active.state).toBe('active');

    const soon = await mkLicense(product.id, {
      expiresAt: new Date(Date.now() + 5 * DAY_MS).toISOString(),
    });
    expect(soon.state).toBe('expiringSoon');
  });

  it('never accepts a derived number on a write', async () => {
    const product = await mkProduct();
    for (const body of [{ seatsUsed: 3 }, { state: 'active' }]) {
      const res = await request(app)
        .post('/api/v1/it/licenses')
        .set('Authorization', `Bearer ${licToken}`)
        .send({ productId: product.id, ...body });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('refuses an inactive product and an inactive vendor (422)', async () => {
    const product = await mkProduct();
    expect(
      (
        await request(app)
          .patch(`/api/v1/it/software-products/${product.id}`)
          .set('Authorization', `Bearer ${swToken}`)
          .send({ active: false, version: product.version })
      ).status,
    ).toBe(200);
    const res = await request(app)
      .post('/api/v1/it/licenses')
      .set('Authorization', `Bearer ${licToken}`)
      .send({ productId: product.id });
    expect(res.status).toBe(422);

    const live = await mkProduct();
    const badVendor = await request(app)
      .post('/api/v1/it/licenses')
      .set('Authorization', `Bearer ${licToken}`)
      .send({ productId: live.id, purchase: { vendorId: '0000000000000000000000ff' } });
    expect(badVendor.status).toBe(422);

    const good = await mkLicense(live.id, { purchase: { vendorId, invoiceRef: 'INV-1' } });
    expect(good.purchase?.vendorId).toBe(vendorId);
  });

  it('fixes a licence to its product and never deletes one', async () => {
    const product = await mkProduct();
    const license = await mkLicense(product.id);
    const other = await mkProduct();
    const repoint = await request(app)
      .patch(`/api/v1/it/licenses/${license.id}`)
      .set('Authorization', `Bearer ${licToken}`)
      .send({ productId: other.id, version: license.version });
    expect(repoint.status).toBe(400);

    expect(
      (
        await request(app)
          .delete(`/api/v1/it/licenses/${license.id}`)
          .set('Authorization', `Bearer ${adminToken}`)
      ).status,
    ).toBe(404);
  });

  // §13-Q5 adopted plain text under the permission, so the key comes back — and there is no
  // reveal endpoint to gate separately.
  it('returns the licence key to a licence viewer', async () => {
    const product = await mkProduct();
    const license = await mkLicense(product.id, { licenseKey: 'ABCD-EFGH-IJKL' });
    expect((await getLicense(license.id)).licenseKey).toBe('ABCD-EFGH-IJKL');
    expect(
      (
        await request(app)
          .get(`/api/v1/it/licenses/${license.id}/reveal`)
          .set('Authorization', `Bearer ${licToken}`)
      ).status,
    ).toBe(404);
  });
});

// ── The expiry sweep (§4.8, ADR-025) ────────────────────────────────────────

describe('the expiry sweep', () => {
  const expiredLicense = async (daysAgo: number): Promise<ItLicenseDto> => {
    const product = await mkProduct();
    const license = await mkLicense(product.id, { seats: 5 });
    await ItLicenseModel.updateOne(
      { _id: license.id },
      { $set: { expiresAt: new Date(Date.now() - daysAgo * DAY_MS) } },
    ).exec();
    return license;
  };

  it('announces an expired licence exactly once, however often it runs', async () => {
    const license = await expiredLicense(2);
    await expirySweep();
    await expirySweep();
    await expirySweep();

    await waitFor(() =>
      eventsNamed(ItEvents.LicenseExpired).some(
        (e) => (e.payload as { licenseId: string }).licenseId === license.id,
      ),
    );
    const fired = eventsNamed(ItEvents.LicenseExpired).filter(
      (e) => (e.payload as { licenseId: string }).licenseId === license.id,
    );
    expect(fired).toHaveLength(1);
  });

  // ADR-025's whole point: the mark key embeds the announced DATE, so a renewal re-arms the
  // warning without anyone clearing a flag.
  it('re-arms after a renewal', async () => {
    const license = await expiredLicense(1);
    await expirySweep();
    // Events fan out fire-and-forget, so poll before asserting — never assert immediately.
    await waitFor(() =>
      eventsNamed(ItEvents.LicenseExpired).some(
        (e) => (e.payload as { licenseId: string }).licenseId === license.id,
      ),
    );
    expect(
      eventsNamed(ItEvents.LicenseExpired).filter(
        (e) => (e.payload as { licenseId: string }).licenseId === license.id,
      ),
    ).toHaveLength(1);

    // Renew into the warn window: a NEW date, so a new announcement is owed.
    await ItLicenseModel.updateOne(
      { _id: license.id },
      { $set: { expiresAt: new Date(Date.now() + 3 * DAY_MS) } },
    ).exec();
    await expirySweep();

    await waitFor(() =>
      eventsNamed(ItEvents.LicenseExpiring).some(
        (e) => (e.payload as { licenseId: string }).licenseId === license.id,
      ),
    );
    expect(
      eventsNamed(ItEvents.LicenseExpiring).filter(
        (e) => (e.payload as { licenseId: string }).licenseId === license.id,
      ),
    ).toHaveLength(1);
  });

  it('never announces a perpetual licence', async () => {
    const product = await mkProduct();
    const license = await mkLicense(product.id);
    await expirySweep();
    for (const name of [ItEvents.LicenseExpiring, ItEvents.LicenseExpired]) {
      expect(
        eventsNamed(name).some((e) => (e.payload as { licenseId: string }).licenseId === license.id),
      ).toBe(false);
    }
  });

  it('announces a warranty, and skips a disposed asset\'s', async () => {
    const asset = await mkAsset();
    await ItAssetModel.updateOne(
      { _id: asset.id },
      {
        $set: {
          warranty: {
            vendorId: null,
            start: new Date(Date.now() - 400 * DAY_MS),
            end: new Date(Date.now() - DAY_MS),
            terms: null,
          },
        },
      },
    ).exec();

    const doomed = await mkAsset();
    await ItAssetModel.updateOne(
      { _id: doomed.id },
      {
        $set: {
          status: 'disposed',
          warranty: {
            vendorId: null,
            start: new Date(Date.now() - 400 * DAY_MS),
            end: new Date(Date.now() - DAY_MS),
            terms: null,
          },
        },
      },
    ).exec();

    await expirySweep();
    await waitFor(() =>
      eventsNamed(ItEvents.AssetWarrantyExpired).some(
        (e) => (e.payload as { assetId: string }).assetId === asset.id,
      ),
    );
    expect(
      eventsNamed(ItEvents.AssetWarrantyExpired).some(
        (e) => (e.payload as { assetId: string }).assetId === asset.id,
      ),
    ).toBe(true);
    // A gone machine's warranty is nobody's problem.
    expect(
      eventsNamed(ItEvents.AssetWarrantyExpired).some(
        (e) => (e.payload as { assetId: string }).assetId === doomed.id,
      ),
    ).toBe(false);
  });

  // 0 is the honest "no early warning". It must not also silence the expiry.
  it('honours a zero warn window for the warning but not for the expiry', async () => {
    await setWarnDays(ItSettingKeys.LicenseWarnDays, 0);
    const product = await mkProduct();
    const soon = await mkLicense(product.id, {
      expiresAt: new Date(Date.now() + 3 * DAY_MS).toISOString(),
    });
    const gone = await expiredLicense(3);

    await expirySweep();
    await waitFor(() =>
      eventsNamed(ItEvents.LicenseExpired).some(
        (e) => (e.payload as { licenseId: string }).licenseId === gone.id,
      ),
    );
    expect(
      eventsNamed(ItEvents.LicenseExpiring).some(
        (e) => (e.payload as { licenseId: string }).licenseId === soon.id,
      ),
    ).toBe(false);
    expect(
      eventsNamed(ItEvents.LicenseExpired).some(
        (e) => (e.payload as { licenseId: string }).licenseId === gone.id,
      ),
    ).toBe(true);

    await setWarnDays(ItSettingKeys.LicenseWarnDays, 30);
    await expirySweep();
    await waitFor(() =>
      eventsNamed(ItEvents.LicenseExpiring).some(
        (e) => (e.payload as { licenseId: string }).licenseId === soon.id,
      ),
    );
    expect(
      eventsNamed(ItEvents.LicenseExpiring).some(
        (e) => (e.payload as { licenseId: string }).licenseId === soon.id,
      ),
    ).toBe(true);
  });
});

// ── Permissions and scope (§7) ──────────────────────────────────────────────

describe('software permissions', () => {
  it('locks every IT-5 read out of a principal with no IT grant (403)', async () => {
    for (const path of ['/it/software-products', '/it/software-installations', '/it/licenses']) {
      const res = await request(app)
        .get(`/api/v1${path}`)
        .set('Authorization', `Bearer ${outsiderToken}`);
      expect(res.status, path).toBe(403);
    }
  });

  it('separates managing software from reading it', async () => {
    const asset = await mkAsset();
    const product = await mkProduct();
    expect(
      (
        await request(app)
          .post('/api/v1/it/software-products')
          .set('Authorization', `Bearer ${readerToken}`)
          .send({ name: 'Denied' })
      ).status,
    ).toBe(403);
    expect((await install({ assetId: asset.id, productId: product.id }, readerToken)).status).toBe(
      403,
    );
  });

  // §7 gives products and installations ONE grant, and licences their own. A software
  // administrator must not be able to edit purchase records.
  it('keeps licence writes away from the software administrator', async () => {
    const product = await mkProduct();
    const res = await request(app)
      .post('/api/v1/it/licenses')
      .set('Authorization', `Bearer ${swToken}`)
      .send({ productId: product.id });
    expect(res.status).toBe(403);
  });

  it('lets a licence administrator read the product catalogue', async () => {
    const res = await request(app)
      .get('/api/v1/it/software-products')
      .set('Authorization', `Bearer ${licToken}`);
    expect(res.status).toBe(200);
  });

  // The owner's condition on §7: holding `itSoftware.manage` must not widen which assets a caller
  // can reach. The asset is loaded through the software grant's own scope.
  it('does not let itSoftware.manage cross a branch boundary', async () => {
    const assetA = await mkAsset({ branchId: branchAId });
    const assetB = await mkAsset({ branchId: branchBId });
    const product = await mkProduct();

    // Another branch's machine refuses exactly as a non-existent one does.
    expect(
      (await install({ assetId: assetA.id, productId: product.id }, branchSwToken)).status,
    ).toBe(422);
    // Their own branch's works.
    const own = await mkInstall(
      { assetId: assetB.id, productId: product.id },
      branchSwToken,
    );
    expect(own.assetId).toBe(assetB.id);
  });

  it('hides another branch\'s installations from a branch-scoped reader', async () => {
    const assetA = await mkAsset({ branchId: branchAId });
    const product = await mkProduct();
    const hidden = await mkInstall({ assetId: assetA.id, productId: product.id });

    const res = await request(app)
      .get('/api/v1/it/software-installations?pageSize=100')
      .set('Authorization', `Bearer ${branchSwToken}`);
    expect(res.status).toBe(200);
    expect(data<ItSoftwareInstallationDto[]>(res).map((r) => r.id)).not.toContain(hidden.id);

    expect(
      (
        await request(app)
          .get(`/api/v1/it/software-installations/${hidden.id}`)
          .set('Authorization', `Bearer ${branchSwToken}`)
      ).status,
    ).toBe(404);
  });

  // The count is a COMPANY fact: showing a branch reader a smaller number would not be a narrower
  // view, it would be a wrong one.
  it('keeps seatsUsed a company number even for a branch-scoped reader', async () => {
    const product = await mkProduct();
    const license = await mkLicense(product.id, { seats: 10 });
    const assetA = await mkAsset({ branchId: branchAId });
    const assetB = await mkAsset({ branchId: branchBId });
    await mkInstall({ assetId: assetA.id, productId: product.id, licenseId: license.id });
    await mkInstall({ assetId: assetB.id, productId: product.id, licenseId: license.id });

    expect((await getLicense(license.id, branchSwToken)).seatsUsed).toBe(2);
  });
});
