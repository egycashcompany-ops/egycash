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
