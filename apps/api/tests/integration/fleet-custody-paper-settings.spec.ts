// «إعداد المذكرات» against a real mongo, over HTTP — the names his seven papers print with: his own
// until somebody saves; read by whoever sees the custody screen; saved only by whoever may also
// edit custody receipts; round-tripped space for space; versioned; audited.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { Types } from 'mongoose';
import {
  DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES,
  type FleetCustodyPaperSet,
  type FleetCustodyPaperSettingsDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { rbacService } from '../../src/platform/rbac';
import { authService } from '../../src/platform/auth';
import { userService } from '../../src/platform/users';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { getCache } from '../../src/infrastructure/redis/cache';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { FleetCustodyPaperSettingsModel } from '../../src/modules/fleet/custody/custody-paper-settings.model';

let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let viewerToken = '';
let editorToken = '';
let receiptsOnlyToken = '';

const URL_ = '/api/v1/fleet/custody/paper-settings';

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-fleet-custody-papers-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;

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
  await userService.setPassword(String(user._id), 'Str0ng#Pass!', 'passwordReset');
  await userService.forceActivate(String(user._id));
  return String(user._id);
};

/** A user holding exactly `keys`, and a token signed for them (no login spent). */
const tokenWith = async (email: string, keys: string[], actor: string): Promise<string> => {
  const role = await rbacService.createRole(
    { name: { en: email, ar: email }, permissionKeys: keys },
    actor,
  );
  const userId = await mkUser(email);
  await rbacService.ensureAssignment(userId, String(role._id), 'organization');
  return authService.signAccessToken(userId, new Types.ObjectId().toString(), 0);
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();
  const actor = await mkUser('papers-actor@ecms.local');
  viewerToken = await tokenWith('papers-viewer@ecms.local', ['fleetCustody.view'], actor);
  editorToken = await tokenWith(
    'papers-editor@ecms.local',
    ['fleetCustody.view', 'fleetReceipt.edit'],
    actor,
  );
  receiptsOnlyToken = await tokenWith(
    'papers-receipts@ecms.local',
    ['fleetReceipt.view', 'fleetReceipt.edit'],
    actor,
  );
}, 240_000);

afterAll(async () => {
  await getCache().close();
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

const withNames = (papers: FleetCustodyPaperSet): FleetCustodyPaperSet => {
  const next = structuredClone(papers);
  // His inner double spaces must come back exactly: a trim of the ENDS only.
  next.tyres.blocks[0] = { ...next.tyres.blocks[0]!, name: '  النقيب  /  اسم   جديد  ' };
  next.charge.blocks[2] = { ...next.charge.blocks[2]!, on: false };
  next.maintenance.note = 'يرجى  المراجعة';
  return next;
};

describe('«إعداد المذكرات»', () => {
  it('before anybody saved: his own names on all seven papers, version null', async () => {
    const res = await request(app).get(URL_).set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(200);
    expect(data<FleetCustodyPaperSettingsDto>(res)).toEqual({
      papers: DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES,
      version: null,
    });
  });

  it('reading needs the custody screen’s grant — the receipts’ alone is not enough', async () => {
    const res = await request(app).get(URL_).set('Authorization', `Bearer ${receiptsOnlyToken}`);
    expect(res.status).toBe(403);
  });

  it('saving needs `fleetReceipt.edit` on top of `fleetCustody.view`', async () => {
    const body = { papers: withNames(DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES) };
    for (const token of [viewerToken, receiptsOnlyToken]) {
      const res = await request(app).put(URL_).set('Authorization', `Bearer ${token}`).send(body);
      expect(res.status).toBe(403);
    }
    expect(await FleetCustodyPaperSettingsModel.countDocuments().exec()).toBe(0);
  });

  it('refuses a paper whose blocks are not its roles in order, or a memo preparer switched off', async () => {
    const wrongOrder = structuredClone(DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES);
    wrongOrder.fuel.blocks.reverse();
    const offPreparer = structuredClone(DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES);
    offPreparer.wash.blocks[0] = { ...offPreparer.wash.blocks[0]!, on: false };
    for (const papers of [wrongOrder, offPreparer]) {
      const res = await request(app)
        .put(URL_)
        .set('Authorization', `Bearer ${editorToken}`)
        .send({ papers });
      expect(res.status).toBe(400);
    }
  });

  it('saves, then reads back exactly what was saved — inner spaces kept — and audits it', async () => {
    const papers = withNames(DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES);
    const saved = await request(app)
      .put(URL_)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ papers });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const dto = data<FleetCustodyPaperSettingsDto>(saved);
    expect(dto.version).toBe(0);
    expect(dto.papers.tyres.blocks[0]?.name).toBe('النقيب  /  اسم   جديد');
    expect(dto.papers.maintenance.note).toBe('يرجى  المراجعة');
    expect(dto.papers.charge.blocks[2]?.on).toBe(false);

    const read = await request(app).get(URL_).set('Authorization', `Bearer ${viewerToken}`);
    expect(data<FleetCustodyPaperSettingsDto>(read)).toEqual(dto);

    const audit = await AuditLogModel.find({
      'entityRef.moduleId': 'fleet',
      'entityRef.entityType': 'custodyPaperSettings',
    })
      .lean()
      .exec();
    expect(audit.map((row) => row.action)).toEqual(['create']);
    expect(audit[0]?.changes.map((change) => change.field).sort()).toEqual([
      'charge',
      'fuel',
      'maintenance',
      'replenish',
      'settle',
      'tyres',
      'wash',
    ]);
  });

  it('a second save carries the version; a stale one is 409 and changes nothing', async () => {
    const current = data<FleetCustodyPaperSettingsDto>(
      await request(app).get(URL_).set('Authorization', `Bearer ${viewerToken}`),
    );
    const next = structuredClone(current.papers);
    next.fuel.blocks[1] = { ...next.fuel.blocks[1]!, name: 'عميد / اسم آخر' };
    const ok = await request(app)
      .put(URL_)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ papers: next, version: current.version });
    expect(ok.status).toBe(200);
    expect(data<FleetCustodyPaperSettingsDto>(ok).version).toBe((current.version ?? 0) + 1);

    const stale = await request(app)
      .put(URL_)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ papers: current.papers, version: current.version });
    expect(stale.status).toBe(409);
    const after = data<FleetCustodyPaperSettingsDto>(
      await request(app).get(URL_).set('Authorization', `Bearer ${viewerToken}`),
    );
    expect(after.papers.fuel.blocks[1]?.name).toBe('عميد / اسم آخر');

    const updates = await AuditLogModel.countDocuments({
      'entityRef.entityType': 'custodyPaperSettings',
      action: 'update',
    }).exec();
    expect(updates).toBe(1);
  });

  it('a paper stored under an older shape prints his names, the others as saved', async () => {
    await FleetCustodyPaperSettingsModel.updateOne(
      { key: 'default' },
      { $set: { 'papers.wash': { agent: 'old' } } },
    ).exec();
    const read = data<FleetCustodyPaperSettingsDto>(
      await request(app).get(URL_).set('Authorization', `Bearer ${viewerToken}`),
    );
    expect(read.papers.wash).toEqual(DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES.wash);
    expect(read.papers.fuel.blocks[1]?.name).toBe('عميد / اسم آخر');
  });

  it('a save without a version once a set-up exists is stale — it never overwrites', async () => {
    const before = data<FleetCustodyPaperSettingsDto>(
      await request(app).get(URL_).set('Authorization', `Bearer ${viewerToken}`),
    );
    const next = structuredClone(before.papers);
    next.tyres.blocks[1] = { ...next.tyres.blocks[1]!, name: 'اسم من صفحة قديمة' };
    const res = await request(app)
      .put(URL_)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ papers: next });
    expect(res.status).toBe(409);
    expect((res.body as { error: { code: string } }).error.code).toBe('STALE_DOCUMENT');
    const after = data<FleetCustodyPaperSettingsDto>(
      await request(app).get(URL_).set('Authorization', `Bearer ${viewerToken}`),
    );
    expect(after).toEqual(before);
  });

  it('two first saves at once: one writes, the other is stale — the first one’s names stay', async () => {
    await FleetCustodyPaperSettingsModel.deleteMany({}).exec();
    const first = withNames(DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES);
    const second = structuredClone(DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES);
    second.fuel.blocks[2] = { ...second.fuel.blocks[2]!, name: 'الاستاذ / اسم ثان' };
    const results = await Promise.all(
      [first, second].map((papers) =>
        request(app).put(URL_).set('Authorization', `Bearer ${editorToken}`).send({ papers }),
      ),
    );
    const statuses = results.map((res) => res.status).sort();
    expect(statuses).toEqual([200, 409]);
    const refused = results.find((res) => res.status === 409);
    expect((refused?.body as { error: { code: string } }).error.code).toBe('STALE_DOCUMENT');
    const won = results.find((res) => res.status === 200);
    const read = data<FleetCustodyPaperSettingsDto>(
      await request(app).get(URL_).set('Authorization', `Bearer ${viewerToken}`),
    );
    expect(read).toEqual(data<FleetCustodyPaperSettingsDto>(won!));
    expect(await FleetCustodyPaperSettingsModel.countDocuments().exec()).toBe(1);
  });
});
