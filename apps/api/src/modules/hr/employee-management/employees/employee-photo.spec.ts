// The photo endpoints' own logic, with the database and the Files service mocked.
//
// The integration suite (`tests/integration/hr-employee-photo.spec.ts`) proves the whole path over
// HTTP against MongoDB. This pins what the employee service decides on the way — which file is
// filed where, which version the link is written under, what is retired, what is withdrawn when the
// link does not land, and what is served — so a failure there can be told apart from a wiring one,
// and so the rules run where no MongoDB binary can be fetched.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const repo = vi.hoisted(() => ({
  getById: vi.fn(),
  updateById: vi.fn(),
  findByUserIdSystem: vi.fn(),
  findById: vi.fn(),
}));
const files = vi.hoisted(() => ({
  upload: vi.fn(),
  softDelete: vi.fn(),
  list: vi.fn(),
  getById: vi.fn(),
  readEntityOwnedBuffer: vi.fn(),
}));
const audit = vi.hoisted(() => ({ record: vi.fn() }));

vi.mock('./employee.repository', () => ({ employeeRepository: repo }));
vi.mock('../../../../platform/files', () => ({
  fileService: files,
  fileCategoryService: { ensure: async () => ({ _id: 'CATEGORY' }) },
}));
vi.mock('../../../../platform/audit', () => ({ auditService: audit }));

const { employeeService } = await import('./employee.service');
const { NotFoundError } = await import('../../../../shared/errors');

const ctx = { userId: 'U1' } as never;
const scope = { scope: 'organization' } as never;
const ID = String(new Types.ObjectId());
const OLD = new Types.ObjectId();
const NEW = new Types.ObjectId();
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const employee = (photoFileId: Types.ObjectId | null) => ({
  _id: new Types.ObjectId(ID),
  code: '0010125',
  __v: 4,
  personal: { photoFileId },
});

const png = (mime = 'image/png') => ({
  originalName: 'face.png',
  mime,
  size: PNG.length,
  buffer: PNG,
});

const OWN_PHOTO = { moduleId: 'hr', entityType: 'employeePhoto', entityId: ID };

beforeEach(() => {
  for (const group of [repo, files, audit]) {
    for (const fn of Object.values(group)) fn.mockReset();
  }
  files.softDelete.mockResolvedValue(undefined);
});

describe('setting or replacing the photo', () => {
  it('files it as this employee’s photo, links it under the version read, retires the rest', async () => {
    repo.getById.mockResolvedValue(employee(OLD));
    files.upload.mockResolvedValue({ _id: NEW });
    repo.updateById.mockResolvedValue({ ...employee(NEW), __v: 5 });
    files.list.mockResolvedValue({ items: [{ _id: NEW }, { _id: OLD }] });

    const updated = await employeeService.setPhoto(ctx, ID, png('image/jpeg'), scope);

    expect(updated.__v).toBe(5);
    const [, fields, binary] = files.upload.mock.calls[0] ?? [];
    expect(fields).toMatchObject({ ...OWN_PHOTO, categoryId: 'CATEGORY', visibility: 'private' });
    // Labelled JPEG, signed PNG: filed as what the bytes are.
    expect((binary as { mime: string }).mime).toBe('image/png');
    expect(repo.updateById).toHaveBeenCalledWith(
      ID,
      { 'personal.photoFileId': NEW },
      { by: 'U1', version: 4, scope },
    );
    // Listed under the DELETE intent, and everything but the new photo is retired.
    expect(files.list.mock.calls[0]?.[0]).toMatchObject(OWN_PHOTO);
    expect(files.list.mock.calls[0]?.[3]).toBe('delete');
    expect(files.softDelete.mock.calls.map((call) => call[1])).toEqual([String(OLD)]);
    expect(audit.record).toHaveBeenCalledWith({
      entityRef: { moduleId: 'hr', entityType: 'employee', entityId: ID },
      action: 'update',
      changes: [{ field: 'personal.photoFileId', old: String(OLD), new: String(NEW) }],
    });
  });

  it('refuses what is not a photo before anything is filed', async () => {
    repo.getById.mockResolvedValue(employee(null));
    const text = { originalName: 'x.txt', mime: 'text/plain', size: 3, buffer: Buffer.from('abc') };
    await expect(employeeService.setPhoto(ctx, ID, text, scope)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(files.upload).not.toHaveBeenCalled();
  });

  it('files nothing for an employee outside the caller’s scope', async () => {
    repo.getById.mockRejectedValue(new NotFoundError());
    await expect(employeeService.setPhoto(ctx, ID, png(), scope)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(files.upload).not.toHaveBeenCalled();
  });

  it('withdraws the new file when the link does not land, and audits nothing', async () => {
    repo.getById.mockResolvedValue(employee(OLD));
    files.upload.mockResolvedValue({ _id: NEW });
    repo.updateById.mockRejectedValue(new Error('stale version'));

    await expect(employeeService.setPhoto(ctx, ID, png(), scope)).rejects.toThrow('stale version');

    expect(files.softDelete).toHaveBeenCalledTimes(1);
    expect(files.softDelete).toHaveBeenCalledWith(ctx, String(NEW));
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('does not fail a change that happened because an old photo could not be retired', async () => {
    repo.getById.mockResolvedValue(employee(OLD));
    files.upload.mockResolvedValue({ _id: NEW });
    repo.updateById.mockResolvedValue(employee(NEW));
    files.list.mockRejectedValue(new Error('files unavailable'));

    await expect(employeeService.setPhoto(ctx, ID, png(), scope)).resolves.toBeDefined();
    expect(audit.record).toHaveBeenCalledTimes(1);
  });
});

describe('removing the photo', () => {
  it('clears the link under the version read, retires every photo, audits', async () => {
    repo.getById.mockResolvedValue(employee(OLD));
    repo.updateById.mockResolvedValue(employee(null));
    files.list.mockResolvedValue({ items: [{ _id: OLD }] });

    await employeeService.removePhoto(ctx, ID, scope);

    expect(repo.updateById).toHaveBeenCalledWith(
      ID,
      { 'personal.photoFileId': null },
      { by: 'U1', version: 4, scope },
    );
    expect(files.softDelete.mock.calls.map((call) => call[1])).toEqual([String(OLD)]);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: [{ field: 'personal.photoFileId', old: String(OLD), new: null }],
      }),
    );
  });

  it('is idempotent: no photo answers the employee unchanged, writing and auditing nothing', async () => {
    const before = employee(null);
    repo.getById.mockResolvedValue(before);
    expect(await employeeService.removePhoto(ctx, ID, scope)).toBe(before);
    expect(repo.updateById).not.toHaveBeenCalled();
    expect(files.softDelete).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('reading the photo', () => {
  const bytes = { doc: { mime: 'image/png', originalName: 'face.png' }, buffer: PNG };

  it('serves the bytes of a file filed as this employee’s photo, asking as the caller', async () => {
    repo.getById.mockResolvedValue(employee(OLD));
    files.getById.mockResolvedValue({ entityRef: OWN_PHOTO });
    files.readEntityOwnedBuffer.mockResolvedValue(bytes);

    const photo = await employeeService.readPhoto(ctx, ID, scope);

    expect(photo).toEqual({ buffer: PNG, mime: 'image/png', fileName: 'face.png' });
    expect(repo.getById).toHaveBeenCalledWith(ID, scope);
    expect(files.getById).toHaveBeenCalledWith(String(OLD), undefined, ctx);
    expect(files.readEntityOwnedBuffer).toHaveBeenCalledWith(ctx, String(OLD));
  });

  // A file filed under the photo type by the generic Files routes skipped the upload's check: the
  // bytes are checked again, and served as what they ARE, never as the label they were filed under.
  it('serves the bytes as their real type, and answers «no photo» when they are not an image', async () => {
    repo.getById.mockResolvedValue(employee(OLD));
    files.getById.mockResolvedValue({ entityRef: OWN_PHOTO });
    files.readEntityOwnedBuffer.mockResolvedValue({
      doc: { mime: 'image/svg+xml', originalName: 'face.svg' },
      buffer: PNG,
    });
    expect((await employeeService.readPhoto(ctx, ID, scope)).mime).toBe('image/png');

    files.readEntityOwnedBuffer.mockResolvedValue({
      doc: { mime: 'image/png', originalName: 'face.png' },
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      ),
    });
    await expect(employeeService.readPhoto(ctx, ID, scope)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('answers «no photo» for a link to any other file — and never reads its bytes', async () => {
    repo.getById.mockResolvedValue(employee(OLD));
    files.getById.mockResolvedValue({
      entityRef: { moduleId: 'hr', entityType: 'employeeNationalIdCard', entityId: ID },
    });
    await expect(employeeService.readPhoto(ctx, ID, scope)).rejects.toBeInstanceOf(NotFoundError);

    files.getById.mockResolvedValue({ entityRef: { ...OWN_PHOTO, entityId: 'SOMEONE-ELSE' } });
    await expect(employeeService.readPhoto(ctx, ID, scope)).rejects.toBeInstanceOf(NotFoundError);
    expect(files.readEntityOwnedBuffer).not.toHaveBeenCalled();
  });

  it('answers «no photo» for a retired or unreadable file, and lets a real failure through', async () => {
    repo.getById.mockResolvedValue(employee(OLD));
    files.getById.mockRejectedValue(new NotFoundError());
    await expect(employeeService.readPhoto(ctx, ID, scope)).rejects.toBeInstanceOf(NotFoundError);

    files.getById.mockRejectedValue(new Error('database down'));
    await expect(employeeService.readPhoto(ctx, ID, scope)).rejects.toThrow('database down');
  });

  it('answers 404 when there is no photo, or no employee behind the login', async () => {
    repo.getById.mockResolvedValue(employee(null));
    await expect(employeeService.readPhoto(ctx, ID, scope)).rejects.toBeInstanceOf(NotFoundError);

    repo.findByUserIdSystem.mockResolvedValue(null);
    await expect(employeeService.readMyPhoto(ctx)).rejects.toBeInstanceOf(NotFoundError);
    expect(repo.findByUserIdSystem).toHaveBeenCalledWith('U1');
    expect(files.getById).not.toHaveBeenCalled();
  });

  it('reads the caller’s own photo from the token, not from anything in the request', async () => {
    repo.findByUserIdSystem.mockResolvedValue(employee(OLD));
    files.getById.mockResolvedValue({ entityRef: OWN_PHOTO });
    files.readEntityOwnedBuffer.mockResolvedValue(bytes);

    expect((await employeeService.readMyPhoto(ctx)).buffer).toBe(PNG);
    expect(repo.getById).not.toHaveBeenCalled();
  });
});

// The same three rules `self-profile.spec.ts` pins for `/me`, held for the two new `/me` reads.
describe('the routes', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const routes = readFileSync(resolve(HERE, 'employee.routes.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '');
  /** The whole `router.<method>(<path>, …);` declaration, single- or multi-line. */
  const declaration = (method: string, path: string): string => {
    const literal = path.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    const match = new RegExp(`router\\.${method}\\(\\s*${literal}[\\s\\S]*?\\);`).exec(routes);
    expect(match, `${method} ${path} is gone`).not.toBeNull();
    return match?.[0] ?? '';
  };

  it.each(["'/me/summary'", "'/me/photo'"])(
    '%s is authenticated, NOT permission-gated, and declared before /:id',
    (path) => {
      const route = declaration('get', path);
      expect(route).toContain('authenticate');
      expect(route).not.toContain('authorize');
      expect(routes.indexOf(path)).toBeLessThan(routes.indexOf("'/:id'"));
    },
  );

  it('reads a photo with employee.view and changes one with employee.editPersonal', () => {
    expect(declaration('get', "'/:id/photo'")).toContain("authorize('employee.view')");
    expect(declaration('post', "'/:id/photo'")).toContain("authorize('employee.editPersonal')");
    expect(declaration('delete', "'/:id/photo'")).toContain("authorize('employee.editPersonal')");
  });
});
