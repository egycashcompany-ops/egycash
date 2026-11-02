// Architecture guards for the applicant documents, read off the source.
//
// These pin what no runtime test can observe, because each is about what the code does NOT do: it
// does not take a person's id from a request on the portal side, it does not mint a staff key for
// uploading, and it does not decide anything by reading first and writing after.
//
// Widen them by NAMING a new file or a new word — never by loosening a pattern.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(resolve(HERE, file), 'utf8');
/** Prose explains the decision; only CODE may contradict it. */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

const FEATURE = readdirSync(HERE)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
  .map((f) => code(read(f)))
  .join('\n');
const ROUTES = code(read('./applicant-document.routes.ts'));
const CONTROLLER = code(read('./applicant-document.controller.ts'));
const SERVICE = code(read('./applicant-document.service.ts'));
const REPOSITORY = code(read('./applicant-document.repository.ts'));
const FOLDER = code(read('./applicant-folder.service.ts'));
const MODULE = code(readFileSync(resolve(HERE, '../../hr.module.ts'), 'utf8'));

describe('D-APP-9 — the candidate is the session, never the request', () => {
  it('gives the portal router no route that names a person', () => {
    const portal = ROUTES.slice(
      ROUTES.indexOf('buildApplicantPortalDocumentsRouter'),
      ROUTES.indexOf('export const buildApplicantDocumentsRouter'),
    );
    expect(portal).not.toContain(':applicantId');
    expect(portal).not.toContain('ApplicantParamSchema');
  });

  it('resolves the candidate from the external subject on their own user record', () => {
    const subject = code(read('./portal-subject.ts'));
    expect(subject).toContain('userService.getById(ctx.userId)');
    expect(subject).toContain('APPLICANT_PORTAL_SUBJECT');
    // Not from a body, a param, or a query — there is nothing here to tamper with.
    expect(subject).not.toContain('req.params');
    expect(subject).not.toContain('req.body');
    expect(subject).not.toContain('req.query');
  });

  it('has every portal controller go through that one resolver', () => {
    for (const handler of ['getMyDocuments', 'submitMyDocument']) {
      const body = CONTROLLER.slice(CONTROLLER.indexOf(`export const ${handler}`));
      expect(body.slice(0, body.indexOf('};')), handler).toContain('portalApplicantId(req)');
    }
  });
});

describe('uploading is the candidate’s act', () => {
  it('mints no staff upload permission', () => {
    const block = MODULE.slice(MODULE.indexOf('applicantDocumentPermissions = declarePermissions'));
    const declaration = block.slice(0, block.indexOf(');'));
    expect(declaration).toContain("action: 'review'");
    // A staff `upload` key would be a door for HR to file a certificate in somebody else's name.
    expect(declaration).not.toContain("'upload'");
  });

  it('refuses a staff WRITE to a candidate’s file even with the review key', () => {
    const files = code(read('./applicant-document.files.ts'));
    expect(files).toContain("intent === 'read' && hasPermission(ctx, 'applicantDocument.review')");
  });
});

describe('emptying a folder is the one staff write, and it is a removal', () => {
  const FILES = code(read('./applicant-document.files.ts'));

  /**
   * REMOVING is answered on its own, and the refusal of every other write is untouched.
   *
   * The distinction is what keeps the promise above true while HR can still clear out a candidate
   * who will not continue: `softDelete` is the only path that asks about a `delete`, so uploading
   * a certificate in somebody's name and replacing the one they filed both still fall to the
   * refusal this feature was built around.
   */
  it('answers a delete with the delete key, and says it understands the difference', () => {
    expect(FILES).toContain('understandsDelete: true');
    expect(FILES).toContain(
      "if (intent === 'delete') return hasPermission(ctx, 'applicantDocument.delete')",
    );
  });

  it('mints the delete key beside view, not as a flavour of review', () => {
    const block = MODULE.slice(MODULE.indexOf('applicantDocumentPermissions = declarePermissions'));
    const declaration = block.slice(0, block.indexOf(');'));
    expect(declaration).toContain("['view', 'delete']");
  });

  /** A key held by the reviewer must not open the bin, and the folder stays readable to them. */
  it('guards both delete routes with the delete key and leaves the reads on view', () => {
    expect(ROUTES).toContain("'/folders/bulk-delete'");
    for (const guarded of [
      "router.delete(\n    '/folders/:applicantId',",
      "router.post(\n    '/folders/bulk-delete',",
    ]) {
      const at = ROUTES.indexOf(guarded);
      expect(at, guarded).toBeGreaterThan(-1);
      expect(ROUTES.slice(at, at + 260)).toContain("authorize('applicantDocument.delete')");
    }
    const read = ROUTES.indexOf("router.get(\n    '/folders/:applicantId',");
    expect(read).toBeGreaterThan(-1);
    expect(ROUTES.slice(read, read + 260)).toContain("authorize('applicantDocument.view')");
  });

  /**
   * The withdrawal that may ride along is VALIDATED, on both routes.
   *
   * It arrives in the body of a DELETE, which is the kind of thing a later refactor tidies away
   * on the grounds that «a DELETE has no body» — and the tidying would leave `withdraw` and a
   * five-hundred-character reason reaching the controller unparsed.
   */
  it('validates the withdrawal on both delete routes', () => {
    for (const [route, schema] of [
      ["router.delete(\n    '/folders/:applicantId',", 'DeleteApplicantFolderSchema'],
      ["router.post(\n    '/folders/bulk-delete',", 'BulkDeleteApplicantFoldersSchema'],
    ] as const) {
      const at = ROUTES.indexOf(route);
      expect(at, route).toBeGreaterThan(-1);
      expect(ROUTES.slice(at, at + 260)).toContain(`body: ${schema}`);
    }
  });

  /**
   * The lifecycle is CALLED, never copied.
   *
   * Writing `status: 'withdrawn'` here instead would skip the engine, and a withdrawn candidate
   * would go on matching every stage queue (I13/I14) — the exact bug the applicants service
   * carries a comment about. The call also has to stay deferred, or this module drags the whole
   * applicant stage in front of itself at load and closes a cycle through the platform's
   * organization and directory services.
   */
  it('withdraws through the applicants service, loaded on demand', () => {
    expect(FOLDER).toContain("await import('../applicants/applicant.service')");
    expect(FOLDER).toContain('applicantService.withdraw(');
    expect(FOLDER).not.toContain("status: 'withdrawn'");
  });

  /**
   * An emptied folder leaves the grid by a rule the FILES settle, and the marker only nominates.
   *
   * A marker trusted on its own would hide a folder that has papers in it again, so the probe is
   * the load-bearing half — and the exclusion has to land in the filter before `skip`, or the page
   * is ragged and the total counts folders nobody can see.
   */
  it('settles the grid’s exclusions against the files, before the page is cut', () => {
    expect(FOLDER).toContain('entityIdsWithLiveFiles');
    const applied = FOLDER.indexOf('filter._id = { $nin: hidden }');
    expect(applied).toBeGreaterThan(-1);
    expect(applied).toBeLessThan(FOLDER.indexOf('.skip((query.page - 1) * query.pageSize)'));
  });

  /** «حذف مبدئي» is the whole promise: an administrator can still get the files back. */
  it('never reaches for a hard or permanent delete', () => {
    for (const forbidden of ['permanentDelete', 'hardDelete', 'deleteOne(', 'deleteMany(']) {
      expect(FEATURE, forbidden).not.toContain(forbidden);
    }
    expect(FOLDER).toContain('.softDelete(ctx, String(file._id))');
  });

  /**
   * THE POINTERS GO BEFORE THE BYTES, and the order is asserted because getting it wrong is
   * invisible: a set row still naming a soft-deleted file leaves the candidate's slot bricked —
   * the queue shows the document as waiting and their next upload is refused — and nothing throws.
   */
  it('drops the handed-in documents set BEFORE the files it points at', () => {
    const dropsSet = FOLDER.indexOf('applicantDocumentRepository.softDeleteForApplicant');
    const dropsFiles = FOLDER.indexOf('.softDelete(ctx, String(file._id))');
    expect(dropsSet).toBeGreaterThan(-1);
    expect(dropsFiles).toBeGreaterThan(-1);
    expect(dropsSet).toBeLessThan(dropsFiles);
  });

  /**
   * The guard reads three collections, and the one that matters most is in another module:
   * an employee's card is COPIED out of the applicant's folder the first time anybody opens it.
   */
  it('refuses a kept record on all three counts, not just the applicant’s own status', () => {
    expect(FOLDER).toContain("applicant.status === 'hired'");
    expect(FOLDER).toContain('findApplicantIdsWithEmployeeSystem');
    expect(FOLDER).toContain('findApplicantIdsWithAcceptedOffer');
    expect(FOLDER).toContain('APPLICANT_FOLDER_KEPT_RECORD');
  });

  /** A folder has no natural size; a capped read would delete only the first page of one. */
  it('pages the folder’s files to exhaustion rather than taking one page', () => {
    expect(FOLDER).not.toMatch(/pageSize:\s*100\s*,\s*sortDir/);
    expect(FOLDER).toContain('FOLDER_PAGE_SIZE');
    expect(FOLDER).toContain('result.items.length < FOLDER_PAGE_SIZE');
  });

  /** `delete` is labelled «حُذف الحساب» on the audit screen, and is a realtime broadcast action. */
  it('audits the act under its own verb', () => {
    expect(FOLDER).toContain("action: 'applicantFolderDeleted'");
    expect(FOLDER).not.toContain("action: 'delete'");
  });
});

describe('every mutation states its condition in the write itself', () => {
  it('guards the first upload on the slot being empty', () => {
    expect(REPOSITORY).toContain("'documents.typeId': { $ne: item.typeId }");
  });

  it('guards a replacement on the slot still being replaceable', () => {
    expect(REPOSITORY).toContain('status: { $in: replaceableStatuses }');
  });

  it('guards a review on the slot still being pending', () => {
    expect(REPOSITORY).toContain("status: 'pending'");
  });

  it('keeps the RULE in the rules module — the repository is told, it does not decide', () => {
    expect(REPOSITORY).not.toContain("=== 'accepted'");
    expect(REPOSITORY).not.toContain('mayReplace');
    expect(SERVICE).toContain('REPLACEABLE');
  });

  it('derives the replaceable statuses from the rule rather than restating them', () => {
    expect(SERVICE).toContain('APPLICANT_DOCUMENT_REVIEW_STATUSES.filter');
    expect(SERVICE).toContain('mayReplace(status)');
  });
});

describe('D-APP-7ج — a replacement is a fresh submission', () => {
  it('clears the previous verdict rather than carrying it forward', () => {
    const replace = REPOSITORY.slice(REPOSITORY.indexOf('async replaceDocument'));
    const body = replace.slice(0, replace.indexOf('async reviewDocument'));
    expect(body).toContain("'documents.$[slot].status': 'pending'");
    expect(body).toContain("'documents.$[slot].reviewedBy': null");
    expect(body).toContain("'documents.$[slot].reviewNote': null");
  });
});

describe('D-APP-5 — the seat decides, not the person', () => {
  it('reads the job title’s flag and never the applicant’s own licences', () => {
    expect(SERVICE).toContain('requiresDrivingTest');
    expect(SERVICE).toContain('placement?.jobTitleId');
    expect(FEATURE).not.toContain('drivingLicenses');
  });
});

describe('no second file store, no second catalogue', () => {
  it('goes through the platform Files service for both writes', () => {
    expect(SERVICE).toContain('fileService.upload');
    expect(SERVICE).toContain('fileService.replace');
  });

  it('holds no bytes of its own', () => {
    for (const forbidden of ['writeFileSync', 'createWriteStream', 'new Schema<File']) {
      expect(FEATURE).not.toContain(forbidden);
    }
  });
});
