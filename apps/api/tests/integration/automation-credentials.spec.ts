// A-4 — the credential store, over HTTP and through the crypto seam.
//
// The claim under test is a NEGATIVE one — "there is no way to read a stored secret back" — so the
// suite is written adversarially: enumerate every response the API can produce for a credential
// and assert the plaintext is in none of them, then probe the read paths an attacker would guess.
// A test that only checks the happy path would pass against an API with a `?reveal=true`.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  automationPermissions,
  platformPermissions,
  type AutomationCredentialDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { automationModule } from '../../src/modules/automation/automation.module';
import { moduleManifests } from '../../src/modules';
import { automationCredentialService } from '../../src/modules/automation/credentials';
import { AutomationCredentialModel } from '../../src/modules/automation/credentials/credential.model';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { cryptoService } from '../../src/platform/crypto';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';

const PASSWORD = 'Str0ng#Pass!';
const SECRET = 'sk-live-9f2b7c41aa-do-not-leak';

let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let viewerToken: string; // credential.view only
let keyCounter = 0;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-automation-credentials-test-${Date.now()}`;
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

const body = <T>(res: { body: unknown }): T => (res.body as { data: T }).data;
const nextKey = (): string => `cred-${(keyCounter += 1)}-${Date.now() % 100000}`;

const createCredential = (key: string, value = SECRET, token = adminToken) =>
  request(app)
    .post('/api/v1/automation/credentials')
    .set('Authorization', `Bearer ${token}`)
    .send({
      key,
      name: { en: 'Outbound mail', ar: 'البريد الصادر' },
      type: 'smtp',
      value,
    });

beforeAll(async () => {
  await bootPlatform({
    mongoUri: await resolveMongoUri(),
    modules: [...moduleManifests, automationModule],
  });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...automationPermissions].map((p) => p.key),
  );
  const adminId = await mkUser('admin@ecms.local');
  await rbacService.ensureAssignment(adminId, String(superAdmin._id), 'organization');
  adminToken = await login('admin@ecms.local');

  const viewerRole = await rbacService.createRole(
    { name: { en: 'Credential viewer', ar: 'مطّلع' }, permissionKeys: ['credential.view'] },
    adminId,
  );
  const viewerId = await mkUser('viewer@ecms.local');
  await rbacService.ensureAssignment(viewerId, String(viewerRole._id), 'organization');
  viewerToken = await login('viewer@ecms.local');
}, 120_000);

afterAll(async () => {
  await disconnectMongo();
  await replSet?.stop();
});

describe('there is no read path', () => {
  it('never returns the value from create, get, list or update', async () => {
    const key = nextKey();
    const created = await createCredential(key);
    expect(created.status).toBe(201);
    const id = body<AutomationCredentialDto>(created).id;

    const responses = [
      created,
      await request(app)
        .get(`/api/v1/automation/credentials/${id}`)
        .set('Authorization', `Bearer ${adminToken}`),
      await request(app)
        .get('/api/v1/automation/credentials')
        .set('Authorization', `Bearer ${adminToken}`),
      await request(app)
        .patch(`/api/v1/automation/credentials/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: { en: 'Renamed', ar: 'مسمّى' }, version: 0 }),
    ];

    for (const res of responses) {
      expect(JSON.stringify(res.body)).not.toContain(SECRET);
    }
  });

  it('shows a fixed mask rather than a prefix of the real value', async () => {
    // A masked prefix leaks entropy and, for a short secret, most of the secret.
    const created = await createCredential(nextKey());
    const dto = body<AutomationCredentialDto>(created);
    expect(dto.masked).toBe('••••••••');
    expect(SECRET.startsWith(dto.masked)).toBe(false);
  });

  it('refuses the read paths an attacker would guess', async () => {
    const id = body<AutomationCredentialDto>(await createCredential(nextKey())).id;
    for (const path of [
      `/api/v1/automation/credentials/${id}/value`,
      `/api/v1/automation/credentials/${id}/reveal`,
      `/api/v1/automation/credentials/${id}/decrypt`,
    ]) {
      const res = await request(app).get(path).set('Authorization', `Bearer ${adminToken}`);
      expect(res.status, path).toBe(404);
    }
  });

  it('does not leak through a query parameter', async () => {
    const id = body<AutomationCredentialDto>(await createCredential(nextKey())).id;
    const res = await request(app)
      .get(`/api/v1/automation/credentials/${id}`)
      .query({ reveal: 'true', includeValue: 'true' })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });

  it('stores no plaintext in the collection', async () => {
    // The API surface could be perfect and the database still hold the secret in the clear.
    const key = nextKey();
    await createCredential(key);
    const doc = await AutomationCredentialModel.findOne({ key }).lean().exec();
    expect(JSON.stringify(doc)).not.toContain(SECRET);
    expect(doc?.sealed.ciphertext).toBeDefined();
  });
});

describe('writing', () => {
  it('rejects a duplicate key', async () => {
    const key = nextKey();
    expect((await createCredential(key)).status).toBe(201);
    expect((await createCredential(key)).status).toBe(422);
  });

  it('replaces a value without ever returning the old one', async () => {
    const key = nextKey();
    const dto = body<AutomationCredentialDto>(await createCredential(key));

    const res = await request(app)
      .put(`/api/v1/automation/credentials/${dto.id}/value`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: 'replacement-secret-value', version: dto.version });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    expect(JSON.stringify(res.body)).not.toContain('replacement-secret-value');

    const [resolved] = await automationCredentialService.resolveForExecution([key]);
    expect(resolved?.value).toBe('replacement-secret-value');
  });

  it('refuses a caller with only credential.view', async () => {
    const res = await createCredential(nextKey(), SECRET, viewerToken);
    expect(res.status).toBe(403);
  });
});

describe('opening a credential for an execution', () => {
  it('round-trips the secret for the dispatcher', async () => {
    const key = nextKey();
    await createCredential(key);
    const [resolved] = await automationCredentialService.resolveForExecution([key]);
    expect(resolved?.value).toBe(SECRET);
    expect(resolved?.type).toBe('smtp');
  });

  it('records that it was used', async () => {
    const key = nextKey();
    await createCredential(key);
    await automationCredentialService.resolveForExecution([key]);
    const doc = await AutomationCredentialModel.findOne({ key }).lean().exec();
    expect(doc?.lastUsedAt).not.toBeNull();
  });

  it('refuses a ciphertext moved to another credential′s row', async () => {
    // The attack AAD binding exists for: someone with write access to the collection swaps one
    // credential's blob into another's row, and the system authenticates with the wrong secret.
    const victimKey = nextKey();
    const attackerKey = nextKey();
    await createCredential(victimKey, 'victim-secret-value');
    await createCredential(attackerKey, 'attacker-secret-value');

    const victim = await AutomationCredentialModel.findOne({ key: victimKey }).lean().exec();
    await AutomationCredentialModel.updateOne(
      { key: attackerKey },
      { $set: { sealed: victim?.sealed } },
    ).exec();

    await expect(automationCredentialService.resolveForExecution([attackerKey])).rejects.toThrow();
  });

  it('fails loudly on an unknown key rather than running with nothing', async () => {
    await expect(
      automationCredentialService.resolveForExecution(['no-such-credential']),
    ).rejects.toThrow();
  });
});

describe('key rotation', () => {
  it('re-wraps onto the active key without touching the ciphertext', async () => {
    const key = nextKey();
    await createCredential(key);
    const before = await AutomationCredentialModel.findOne({ key }).lean().exec();

    // Simulate a value left behind on a retired key: rotation finds it by `sealed.keyId`, which is
    // stored in the clear precisely so this query needs no decryption.
    await AutomationCredentialModel.updateOne(
      { key },
      { $set: { 'sealed.keyId': 'retired-key-id' } },
    ).exec();

    const outcome = await automationCredentialService.rotateKeys();
    // The forged keyId is not in the ring, so this one cannot be re-wrapped — and the sweep counts
    // it rather than throwing, because one bad row must not stop the rest.
    expect(outcome.failed).toBeGreaterThan(0);

    // Restore and confirm a genuine rotation is a no-op on already-active values.
    await AutomationCredentialModel.updateOne(
      { key },
      { $set: { 'sealed.keyId': before?.sealed.keyId } },
    ).exec();
    const clean = await automationCredentialService.rotateKeys();
    expect(clean.failed).toBe(0);

    const after = await AutomationCredentialModel.findOne({ key }).lean().exec();
    expect(after?.sealed.ciphertext).toBe(before?.sealed.ciphertext);
    const [resolved] = await automationCredentialService.resolveForExecution([key]);
    expect(resolved?.value).toBe(SECRET);
  });

  it('reports the active key id without decrypting anything', async () => {
    const dto = body<AutomationCredentialDto>(await createCredential(nextKey()));
    expect(dto.keyId).toBe(cryptoService.status().activeKeyId);
  });
});
