// Compliance and Risks module manifest — «الالتزام والمخاطر» (docs/12-planning/
// compliance-files-design.md). One page so far, «الملفات»: the folders the responsible person
// keeps, each shown only to the people they name, with PDF, Word and Excel files inside and a record
// of who has seen each file.
//
// Two keys on the one page (§4): `complianceFile.manage`, the responsible person's, and
// `complianceFile.view`, which opens the page for a person a folder is shared with — handed out and
// taken back by the module itself, as the reader role, in step with the folders' lists.
import { Router } from 'express';
import { declarePermissions, type PageDef, type PermissionDef } from '@ecms/contracts';
import { type ModuleManifest } from '../../platform/kernel/module-registry';
import { seedCompliance } from './compliance.seed';
import {
  buildComplianceDocumentsRouter,
  buildComplianceFolderDocumentsRouter,
} from './documents/document.routes';
import { complianceFolderFileAuthorizer } from './folders/folder-file-authorizer';
import { buildComplianceFoldersRouter } from './folders/folder.routes';
import { buildCompliancePeopleRouter } from './people/people.routes';

const filePermissions = declarePermissions(
  'compliance',
  'complianceFile',
  { en: 'compliance files', ar: 'ملفات الالتزام والمخاطر' },
  ['view'],
  [
    {
      action: 'manage',
      name: {
        en: 'Manage compliance folders, files and who sees them',
        ar: 'إدارة مجلدات الالتزام والمخاطر وملفاتها ومن يطلع عليها',
      },
    },
  ],
  'compliance.files',
);

export const compliancePermissions: PermissionDef[] = [...filePermissions];

export const compliancePages: PageDef[] = [
  {
    id: 'compliance.files',
    moduleId: 'compliance',
    name: { en: 'Files', ar: 'الملفات' },
    route: '/compliance/files',
    sortOrder: 10,
  },
];

/** A folder's own routes and its files' list and upload, under the one `/compliance/folders`. */
const buildFoldersRouter = (): Router => {
  const router = Router();
  router.use(buildComplianceFoldersRouter());
  router.use(buildComplianceFolderDocumentsRouter());
  return router;
};

export const complianceModule: ModuleManifest = {
  id: 'compliance',
  name: { en: 'Compliance and Risks', ar: 'الالتزام والمخاطر' },
  version: '0.1.0',
  requiresPlatform: '^2.2',
  permissions: compliancePermissions,
  pages: compliancePages,
  routes: [
    { prefix: '/compliance/folders', router: buildFoldersRouter() },
    { prefix: '/compliance/documents', router: buildComplianceDocumentsRouter() },
    { prefix: '/compliance/people', router: buildCompliancePeopleRouter() },
  ],
  collections: ['compliance_folders', 'compliance_documents', 'compliance_document_access'],
  eventSubscriptions: [],
  // Every file the module keeps — a document or a folder's picture — is filed under
  // `compliance/folder`, and the folder's list decides who reads it (§6.1).
  fileEntityAuthorizers: [complianceFolderFileAuthorizer],
  seed: seedCompliance,
};
