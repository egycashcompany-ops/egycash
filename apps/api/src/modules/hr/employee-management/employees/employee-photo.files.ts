// The employee's personal photo: where it is filed, what may be filed, and who may reach it.
//
// «عايزك تضيف فى بروفايل كل شخص صورة شخصية ليه .. ويقدر الـ HR يضيفهاله». The bytes live in the
// Files service like every other document; the employee keeps only the link
// (`personal.photoFileId`). Three things are decided here and nowhere else:
//
//   * THE CATEGORY — JPEG, PNG or WebP, 5 MB at most. The Files service enforces it on every upload
//     into the category, whoever does the uploading.
//   * WHAT COUNTS AS A PHOTO — checked at the edge before the Files service sees it, so the refusal
//     is a validation error that says what is allowed. The bytes are checked as well as the label:
//     these are served back to browsers under the type they were filed with.
//   * WHO MAY REACH ONE (ADR-023) — its own entity type, so the generic file routes ask HR before
//     they serve, list, replace or delete a photo. Reading is seeing the employee (`employee.view`
//     within scope) or BEING the employee; writing is a personal-data edit (`employee.editPersonal`
//     within scope). No permission is minted here.
import {
  EMPLOYEE_PHOTO_ENTITY_TYPE,
  EMPLOYEE_PHOTO_FILE_CATEGORY,
  EMPLOYEE_PHOTO_MAX_MB,
  EMPLOYEE_PHOTO_MIME_TYPES,
  type CreateFileCategory,
  type EntityRef,
} from '@ecms/contracts';
import { ValidationError } from '../../../../shared/errors';
import { hasPermission, scopeSelector, type AuthContext } from '../../../../shared/types';
import {
  fileCategoryService,
  type FileEntityAuthorizer,
  type UploadedBinary,
} from '../../../../platform/files';
import { employeeRepository } from './employee.repository';

const PHOTO_CATEGORY: CreateFileCategory = {
  key: EMPLOYEE_PHOTO_FILE_CATEGORY,
  name: { ar: 'الصور الشخصية للموظفين', en: 'Employee photos' },
  allowedMimeTypes: [...EMPLOYEE_PHOTO_MIME_TYPES],
  maxSizeMb: EMPLOYEE_PHOTO_MAX_MB,
  // A photo is kept for as long as it is the employee's photo; a replaced one is retired with it.
  retentionDays: null,
};

/** Boot-time idempotent seed. */
export const ensureEmployeePhotoCategory = async (): Promise<void> => {
  await fileCategoryService.ensure(PHOTO_CATEGORY);
};

let cachedCategoryId: string | null = null;

/** The category id, ensured and cached on first use — a database seeded before it gets it here. */
export const resolveEmployeePhotoCategoryId = async (): Promise<string> => {
  if (cachedCategoryId === null) {
    const cat = await fileCategoryService.ensure(PHOTO_CATEGORY);
    cachedCategoryId = String(cat._id);
  }
  return cachedCategoryId;
};

export type EmployeePhotoMime = (typeof EMPLOYEE_PHOTO_MIME_TYPES)[number];

export const EMPLOYEE_PHOTO_MAX_BYTES = EMPLOYEE_PHOTO_MAX_MB * 1024 * 1024;

/** Said the same way by every refusal, so a person reads what IS allowed, not only what is not. */
export const EMPLOYEE_PHOTO_TYPE_RULE = 'the photo must be a JPEG, PNG or WebP image';
export const EMPLOYEE_PHOTO_SIZE_RULE = `the photo must be ${String(EMPLOYEE_PHOTO_MAX_MB)} MB or smaller`;

const startsWith = (buffer: Buffer, bytes: readonly number[], at = 0): boolean =>
  buffer.length >= at + bytes.length && bytes.every((byte, index) => buffer[at + index] === byte);

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

/**
 * What the bytes ARE, by their signature — or `null` when they are none of the three.
 *
 * The declared type is whatever the client wrote on the multipart part; the signature is what a
 * browser will actually decode. Pure, so the spec pins it without a server.
 */
export const sniffEmployeePhotoMime = (buffer: Buffer): EmployeePhotoMime | null => {
  if (startsWith(buffer, PNG_SIGNATURE)) return 'image/png';
  if (startsWith(buffer, JPEG_SIGNATURE)) return 'image/jpeg';
  if (startsWith(buffer, RIFF) && startsWith(buffer, WEBP, 8)) return 'image/webp';
  return null;
};

const isAllowedMime = (mime: string): mime is EmployeePhotoMime =>
  (EMPLOYEE_PHOTO_MIME_TYPES as readonly string[]).includes(mime);

/**
 * Refuse anything that is not a photo, with the platform's validation error; hand back the binary
 * to file, labelled with the type its bytes actually carry.
 *
 * Both the label and the bytes have to be one of the three. A PNG saved with a `.jpg` name is still
 * a perfectly good photo, so it is filed as the PNG it is rather than refused; a PDF renamed
 * `photo.png` is not a photo at all.
 */
export const assertEmployeePhoto = (binary: UploadedBinary): UploadedBinary => {
  if (!isAllowedMime(binary.mime)) {
    throw new ValidationError(
      [{ field: 'file', code: 'UNSUPPORTED_MEDIA_TYPE', message: EMPLOYEE_PHOTO_TYPE_RULE }],
      EMPLOYEE_PHOTO_TYPE_RULE,
    );
  }
  if (binary.size > EMPLOYEE_PHOTO_MAX_BYTES || binary.buffer.length > EMPLOYEE_PHOTO_MAX_BYTES) {
    throw new ValidationError(
      [{ field: 'file', code: 'TOO_LARGE', message: EMPLOYEE_PHOTO_SIZE_RULE }],
      EMPLOYEE_PHOTO_SIZE_RULE,
    );
  }
  const actual = sniffEmployeePhotoMime(binary.buffer);
  if (actual === null) {
    throw new ValidationError(
      [{ field: 'file', code: 'UNSUPPORTED_MEDIA_TYPE', message: EMPLOYEE_PHOTO_TYPE_RULE }],
      EMPLOYEE_PHOTO_TYPE_RULE,
    );
  }
  return { ...binary, mime: actual };
};

/**
 * Where an employee's photo is filed. One reference, so filing a photo and retiring the old ones
 * name the same owner and cannot drift apart.
 */
export const employeePhotoRef = (employeeId: string): EntityRef => ({
  moduleId: 'hr',
  entityType: EMPLOYEE_PHOTO_ENTITY_TYPE,
  entityId: employeeId,
});

/**
 * Is this file filed as THIS employee's photo?
 *
 * `personal.photoFileId` is only a link. A file filed under anything else — another module's
 * document, another employee's photo — is not served as this employee's face, whatever the link
 * says.
 */
export const isEmployeePhotoFile = (
  entityRef: EntityRef | undefined,
  employeeId: string,
): boolean => {
  if (entityRef === undefined) return false;
  const expected = employeePhotoRef(employeeId);
  return (
    entityRef.moduleId === expected.moduleId &&
    entityRef.entityType === expected.entityType &&
    entityRef.entityId === expected.entityId
  );
};

/**
 * Can this caller reach the employee under the given key?
 *
 * `findById` applies the scope, so an employee outside it comes back null and the answer is no —
 * the same reason `GET /hr/employees/:id` answers 404 for another branch's record.
 */
const canReach = async (ctx: AuthContext, employeeId: string, key: string): Promise<boolean> =>
  hasPermission(ctx, key) &&
  (await employeeRepository.findById(employeeId, scopeSelector(ctx, key))) !== null;

/** Is the caller the employee the photo belongs to? The login link is the only answer (ADR-017). */
const isSelf = async (ctx: AuthContext, employeeId: string): Promise<boolean> => {
  const own = await employeeRepository.findByUserIdSystem(ctx.userId);
  return own !== null && String(own._id) === employeeId;
};

/**
 * Reading: anybody who may see the employee, and the employee — a person holds no `employee.view`
 * and still sees their own face on their own welcome page. Writing (and removing, which arrives as
 * a write: there is no `understandsDelete` branch, because removing a photo IS editing personal
 * data): `employee.editPersonal`, within scope. Being the employee writes nothing.
 */
export const hrEmployeePhotoFileAuthorizers: FileEntityAuthorizer[] = [
  {
    entityType: EMPLOYEE_PHOTO_ENTITY_TYPE,
    authorize: async ({ ctx, entityId, intent }) => {
      if (intent !== 'read') return canReach(ctx, entityId, 'employee.editPersonal');
      return (await canReach(ctx, entityId, 'employee.view')) || isSelf(ctx, entityId);
    },
  },
];
