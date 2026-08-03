// IT-1 integration suite: catalogs, vendors and the asset register over real HTTP with real
// RBAC. Exercises the server-allocated asset code (FR-1), the derived status (FR-2 — no write
// path accepts one), reference guards (active category / active vendor), the scan resolve, the
// FR-5 delete window, branch data-scoping, and the label sheet's print-view fallback (CI has no
// chromium, so the endpoint answers HTML — the same content the PDF driver would print).
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  ItEvents,
  SettingKeys,
  platformPermissions,
  type ItAssetDto,
  type ItCatalogItemDto,
  type ItVendorDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { itPermissions } from '../../src/modules/it/it.module';
import { subscribe } from '../../src/platform/kernel/event-bus';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let branchAToken: string; // itAsset.view at BRANCH scope, placed in branch A
let branchAId: string;
let branchBId: string;
let categoryId: string;
let ticketCategoryId: string;
let vendorId: string;
const seenEvents: { name: string; payload: unknown }[] = [];

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-it-test-${Date.now()}`;
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

const createAsset = async (
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<request.Response> =>
  request(app)
    .post('/api/v1/it/assets')
    .set('Authorization', `Bearer ${token}`)
    .send({
      name: 'ThinkPad T14',
      categoryId,
      branchId: branchAId,
      ...overrides,
    });

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  subscribe(ItEvents.AssetRegistered, 'spec.itAssetRegistered', (envelope) => {
    seenEvents.push({ name: ItEvents.AssetRegistered, payload: envelope.payload });
  });

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...itPermissions].map((p) => p.key),
  );
  const adminId = await mkUser('admin@ecms.local');
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
  adminToken = await login('admin@ecms.local');

  const mkBranch = async (code: string, ar: string, en: string): Promise<string> => {
    const res = await request(app)
      .post('/api/v1/platform/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code, name: { ar, en } });
    expect(res.status).toBe(201);
    return (res.body as { data: { id: string } }).data.id;
  };
  branchAId = await mkBranch('80', 'فرع أ', 'Branch A');
  branchBId = await mkBranch('81', 'فرع ب', 'Branch B');

  // Branch-scoped viewer: itAsset.view at branch scope, placed in branch A.
  const viewerRole = await rbacService.createRole(
    {
      name: { en: 'IT viewer', ar: 'مطالع أصول' },
      permissionKeys: ['itAsset.view'],
    },
    adminId,
  );
  const viewerId = await mkUser('it-viewer@ecms.local', branchAId);
  await rbacService.ensureAssignment(viewerId, String(viewerRole._id), 'branch');
  branchAToken = await login('it-viewer@ecms.local');
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('it catalogs', () => {
  it('creates both kinds and rejects a duplicate name within a kind', async () => {
    const create = (kind: string, ar: string, en: string) =>
      request(app)
        .post('/api/v1/it/catalog-items')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ kind, name: { ar, en } });

    const cat = await create('assetCategory', 'حواسيب محمولة', 'Laptops');
    expect(cat.status).toBe(201);
    categoryId = data<ItCatalogItemDto>(cat).id;

    const tkt = await create('ticketCategory', 'أعطال أجهزة', 'Hardware');
    expect(tkt.status).toBe(201);
    ticketCategoryId = data<ItCatalogItemDto>(tkt).id;

    // Same Arabic name is fine in the OTHER kind, a conflict within the same kind.
    expect((await create('ticketCategory', 'حواسيب محمولة', 'Laptops')).status).toBe(201);
    expect((await create('assetCategory', 'حواسيب محمولة', 'Laptops 2')).status).toBe(409);
  });

  it('archives instead of deleting', async () => {
    const res = await request(app)
      .post('/api/v1/it/catalog-items')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ kind: 'assetCategory', name: { ar: 'شاشات', en: 'Monitors' } });
    expect(res.status).toBe(201);
    const row = data<ItCatalogItemDto>(res);
    const archived = await request(app)
      .patch(`/api/v1/it/catalog-items/${row.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false, version: row.version });
    expect(archived.status).toBe(200);
    expect(data<ItCatalogItemDto>(archived).isActive).toBe(false);
  });
});

describe('it vendors', () => {
  it('creates a vendor with embedded contacts and finds it by search', async () => {
    const res = await request(app)
      .post('/api/v1/it/vendors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'التقنية المتحدة',
        code: 'UTD',
        services: 'laptops, printers',
        contacts: [{ name: 'أحمد', role: 'Sales', phone: '0100000000' }],
      });
    expect(res.status).toBe(201);
    vendorId = data<ItVendorDto>(res).id;
    expect(data<ItVendorDto>(res).contacts).toHaveLength(1);

    const found = await request(app)
      .get('/api/v1/it/vendors?search=printers')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(found.status).toBe(200);
    expect(data<ItVendorDto[]>(found).some((v) => v.id === vendorId)).toBe(true);
  });

  it('rejects a duplicate vendor name', async () => {
    const res = await request(app)
      .post('/api/v1/it/vendors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'التقنية المتحدة' });
    expect(res.status).toBe(409);
  });
});

describe('asset register', () => {
  it('allocates sequential permanent codes and derives status (FR-1, FR-2)', async () => {
    const first = await createAsset(adminToken, {
      serialNumber: 'SN-1001',
      purchase: { vendorId, cost: 25000 },
      warranty: { vendorId, start: '2026-01-01', end: '2028-01-01' },
    });
    expect(first.status).toBe(201);
    const a1 = data<ItAssetDto>(first);
    expect(a1.assetCode).toBe('AST-00001');
    expect(a1.status).toBe('inStock');
    expect(a1.warranty?.vendorId).toBe(vendorId);

    const second = await createAsset(adminToken, { name: 'HP LaserJet' });
    expect(data<ItAssetDto>(second).assetCode).toBe('AST-00002');

    await waitFor(() => seenEvents.length >= 2);
    expect(
      seenEvents.filter((e) => e.name === ItEvents.AssetRegistered).length,
    ).toBeGreaterThanOrEqual(2);
    const payload = seenEvents[0]?.payload as { assetCode?: string };
    expect(payload.assetCode).toBe('AST-00001');
  });

  it('rejects a ticket category as an asset category and an inactive vendor', async () => {
    const wrongKind = await createAsset(adminToken, { categoryId: ticketCategoryId });
    expect(wrongKind.status).toBe(422);
    const ghostVendor = await createAsset(adminToken, {
      purchase: { vendorId: '0123456789ab0123456789ab' },
    });
    expect(ghostVendor.status).toBe(422);
  });

  it('rejects a duplicate serial number', async () => {
    const res = await createAsset(adminToken, { serialNumber: 'SN-1001' });
    expect(res.status).toBe(409);
  });

  it('resolves by code (the scan path) and 404s an unknown code', async () => {
    const res = await request(app)
      .get('/api/v1/it/assets/by-code/AST-00001')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(data<ItAssetDto>(res).assetCode).toBe('AST-00001');

    const missing = await request(app)
      .get('/api/v1/it/assets/by-code/AST-99999')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(missing.status).toBe(404);
  });

  it('searches by the strings an operator has', async () => {
    const res = await request(app)
      .get('/api/v1/it/assets?search=SN-1001')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const rows = data<ItAssetDto[]>(res);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.assetCode).toBe('AST-00001');
  });

  it('scopes reads by branch', async () => {
    const inB = await createAsset(adminToken, { name: 'Switch B', branchId: branchBId });
    expect(inB.status).toBe(201);

    const scoped = await request(app)
      .get('/api/v1/it/assets')
      .set('Authorization', `Bearer ${branchAToken}`);
    expect(scoped.status).toBe(200);
    const rows = data<ItAssetDto[]>(scoped);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((a) => a.branchId === branchAId)).toBe(true);
  });

  it('forbids creation without the grant', async () => {
    const res = await createAsset(branchAToken, { name: 'nope' });
    expect(res.status).toBe(403);
  });

  it('updates with optimistic locking and never accepts a status', async () => {
    const reg = await createAsset(adminToken, { name: 'Dell OptiPlex' });
    const asset = data<ItAssetDto>(reg);
    const ok = await request(app)
      .patch(`/api/v1/it/assets/${asset.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ location: 'مكتب 12', version: asset.version });
    expect(ok.status).toBe(200);
    expect(data<ItAssetDto>(ok).location).toBe('مكتب 12');

    const smuggled = await request(app)
      .patch(`/api/v1/it/assets/${asset.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'disposed', version: asset.version + 1 });
    expect(smuggled.status).toBe(400);
  });

  it('deletes only inside the FR-5 registered-in-error window', async () => {
    const reg = await createAsset(adminToken, { name: 'typo asset' });
    const asset = data<ItAssetDto>(reg);
    const del = await request(app)
      .delete(`/api/v1/it/assets/${asset.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(del.status).toBe(204);
    const gone = await request(app)
      .get(`/api/v1/it/assets/${asset.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(gone.status).toBe(404);
  });
});

describe('asset labels', () => {
  it('answers with the printable sheet — HTML fallback in CI, where no chromium exists', async () => {
    const list = await request(app)
      .get('/api/v1/it/assets?pageSize=2')
      .set('Authorization', `Bearer ${adminToken}`);
    const ids = data<ItAssetDto[]>(list).map((a) => a.id);
    expect(ids.length).toBeGreaterThan(0);

    const res = await request(app)
      .post('/api/v1/it/assets/labels')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ assetIds: ids });
    expect(res.status).toBe(200);
    const type = res.headers['content-type'] ?? '';
    expect(type.includes('text/html') || type.includes('application/pdf')).toBe(true);
    if (type.includes('text/html')) {
      expect(res.text).toContain('AST-');
      expect(res.text).toContain('data:image/png;base64,');
    }
  });
});
