// The employee photo's rules, tested as pure decisions with the data layer mocked.
//
// The integration suite proves them over HTTP; this pins the logic in isolation — what counts as a
// photo, which file is this employee's photo, and who the Files service lets near one — so a
// failure there can be told apart from a wiring problem.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findById, findByUserIdSystem } = vi.hoisted(() => ({
  findById: vi.fn(),
  findByUserIdSystem: vi.fn(),
}));

vi.mock('./employee.repository', () => ({
  employeeRepository: { findById, findByUserIdSystem },
}));
// Only the category service is reached at import, and only by name: the rules under test never
// touch storage, so the whole Files service has no reason to load.
vi.mock('../../../../platform/files', () => ({ fileCategoryService: { ensure: vi.fn() } }));

const {
  EMPLOYEE_PHOTO_MAX_BYTES,
  assertEmployeePhoto,
  employeePhotoRef,
  hrEmployeePhotoFileAuthorizers,
  isEmployeePhotoFile,
  sniffEmployeePhotoMime,
} = await import('./employee-photo.files');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x24, 0, 0, 0]),
  Buffer.from('WEBPVP8 '),
]);
const PDF = Buffer.from('%PDF-1.7\n');

const binary = (mime: string, buffer: Buffer, size = buffer.length) => ({
  originalName: 'photo',
  mime,
  size,
  buffer,
});

/** The validation error's first detail — what the screen would show. */
const refusal = (run: () => unknown): { code: string; status: number; detail: string } => {
  try {
    run();
  } catch (error) {
    const e = error as {
      code: string;
      httpStatus: number;
      details?: { message: string }[];
    };
    return { code: e.code, status: e.httpStatus, detail: e.details?.[0]?.message ?? '' };
  }
  throw new Error('expected a refusal');
};

describe('what the bytes are', () => {
  it('recognises the three photo formats by their signature', () => {
    expect(sniffEmployeePhotoMime(PNG)).toBe('image/png');
    expect(sniffEmployeePhotoMime(JPEG)).toBe('image/jpeg');
    expect(sniffEmployeePhotoMime(WEBP)).toBe('image/webp');
  });

  it('recognises nothing else — a PDF, text, an empty or truncated file', () => {
    expect(sniffEmployeePhotoMime(PDF)).toBeNull();
    expect(sniffEmployeePhotoMime(Buffer.from('hello'))).toBeNull();
    expect(sniffEmployeePhotoMime(Buffer.alloc(0))).toBeNull();
    expect(sniffEmployeePhotoMime(PNG.subarray(0, 4))).toBeNull();
    // A RIFF container that is not WebP (a WAV file) is not a photo.
    expect(sniffEmployeePhotoMime(Buffer.from('RIFF$\u0000\u0000\u0000WAVEfmt '))).toBeNull();
  });
});

describe('what may be filed as a photo', () => {
  it('accepts a JPEG, a PNG and a WebP image', () => {
    expect(assertEmployeePhoto(binary('image/png', PNG)).mime).toBe('image/png');
    expect(assertEmployeePhoto(binary('image/jpeg', JPEG)).mime).toBe('image/jpeg');
    expect(assertEmployeePhoto(binary('image/webp', WEBP)).mime).toBe('image/webp');
  });

  it('files an image under the type its bytes carry, not the label it came with', () => {
    expect(assertEmployeePhoto(binary('image/jpeg', PNG)).mime).toBe('image/png');
  });

  it.each([
    ['a PDF', 'application/pdf', PDF],
    ['a text file', 'text/plain', Buffer.from('notes')],
    ['an SVG', 'image/svg+xml', Buffer.from('<svg/>')],
  ])('refuses %s with a validation error that says what is allowed', (_label, mime, bytes) => {
    const r = refusal(() => assertEmployeePhoto(binary(mime, bytes)));
    expect(r.status).toBe(400);
    expect(r.code).toBe('VALIDATION_FAILED');
    expect(r.detail).toBe('the photo must be a JPEG, PNG or WebP image');
  });

  it('refuses a file labelled as an image whose bytes are not one', () => {
    const r = refusal(() => assertEmployeePhoto(binary('image/png', PDF)));
    expect(r.code).toBe('VALIDATION_FAILED');
    expect(r.detail).toBe('the photo must be a JPEG, PNG or WebP image');
  });

  it('accepts exactly 5 MB and refuses a byte more, naming the limit', () => {
    const atLimit = Buffer.concat([PNG, Buffer.alloc(EMPLOYEE_PHOTO_MAX_BYTES - PNG.length)]);
    expect(assertEmployeePhoto(binary('image/png', atLimit)).size).toBe(EMPLOYEE_PHOTO_MAX_BYTES);

    const over = Buffer.concat([atLimit, Buffer.alloc(1)]);
    const r = refusal(() => assertEmployeePhoto(binary('image/png', over)));
    expect(r.code).toBe('VALIDATION_FAILED');
    expect(r.detail).toBe('the photo must be 5 MB or smaller');
  });
});

describe('which file is this employee’s photo', () => {
  it('is the one filed under the photo type for this employee', () => {
    expect(employeePhotoRef('E1')).toEqual({
      moduleId: 'hr',
      entityType: 'employeePhoto',
      entityId: 'E1',
    });
    expect(isEmployeePhotoFile(employeePhotoRef('E1'), 'E1')).toBe(true);
  });

  it('is not another employee’s photo, nor any other document', () => {
    expect(isEmployeePhotoFile(employeePhotoRef('E2'), 'E1')).toBe(false);
    expect(
      isEmployeePhotoFile(
        { moduleId: 'hr', entityType: 'employeeNationalIdCard', entityId: 'E1' },
        'E1',
      ),
    ).toBe(false);
    expect(
      isEmployeePhotoFile({ moduleId: 'fleet', entityType: 'employeePhoto', entityId: 'E1' }, 'E1'),
    ).toBe(false);
    expect(isEmployeePhotoFile(undefined, 'E1')).toBe(false);
  });
});

describe('who the Files service lets near a photo', () => {
  const authorizer = hrEmployeePhotoFileAuthorizers[0];
  if (authorizer === undefined) throw new Error('no photo authorizer registered');
  const ctx = (permissions: Record<string, string>, userId = 'U1') =>
    ({ userId, permissions }) as never;
  const EMPLOYEE = { _id: 'E1' };

  beforeEach(() => {
    findById.mockReset();
    findByUserIdSystem.mockReset();
    findByUserIdSystem.mockResolvedValue(null);
  });

  it('claims the photo type, and only it', () => {
    expect(hrEmployeePhotoFileAuthorizers.map((a) => a.entityType)).toEqual(['employeePhoto']);
  });

  it('lets a caller who can see the employee read it', async () => {
    findById.mockResolvedValue(EMPLOYEE);
    expect(
      await authorizer.authorize({
        ctx: ctx({ 'employee.view': 'organization' }),
        entityId: 'E1',
        intent: 'read',
      }),
    ).toBe(true);
  });

  it('lets the employee read their own, with no permission at all', async () => {
    findByUserIdSystem.mockResolvedValue(EMPLOYEE);
    expect(await authorizer.authorize({ ctx: ctx({}), entityId: 'E1', intent: 'read' })).toBe(true);
    expect(findById).not.toHaveBeenCalled();
  });

  it('refuses an employee reading somebody else’s', async () => {
    findByUserIdSystem.mockResolvedValue({ _id: 'E2' });
    expect(await authorizer.authorize({ ctx: ctx({}), entityId: 'E1', intent: 'read' })).toBe(
      false,
    );
  });

  it('refuses a viewer whose scope does not reach the employee', async () => {
    findById.mockResolvedValue(null);
    expect(
      await authorizer.authorize({
        ctx: ctx({ 'employee.view': 'branch' }),
        entityId: 'E1',
        intent: 'read',
      }),
    ).toBe(false);
  });

  it('asks employee.editPersonal to write — viewing it, or being the employee, is not enough', async () => {
    findById.mockResolvedValue(EMPLOYEE);
    findByUserIdSystem.mockResolvedValue(EMPLOYEE);
    expect(
      await authorizer.authorize({
        ctx: ctx({ 'employee.view': 'organization' }),
        entityId: 'E1',
        intent: 'write',
      }),
    ).toBe(false);
    expect(
      await authorizer.authorize({
        ctx: ctx({ 'employee.editPersonal': 'organization' }),
        entityId: 'E1',
        intent: 'write',
      }),
    ).toBe(true);
  });

  it('refuses an editor whose scope does not reach the employee', async () => {
    findById.mockResolvedValue(null);
    expect(
      await authorizer.authorize({
        ctx: ctx({ 'employee.editPersonal': 'branch' }),
        entityId: 'E1',
        intent: 'write',
      }),
    ).toBe(false);
  });

  // No `understandsDelete`: a delete reaches this authorizer as a write, so removing a photo takes
  // exactly what replacing one takes.
  it('does not claim to tell a delete apart from a write', () => {
    expect(authorizer.understandsDelete).toBeUndefined();
  });
});
