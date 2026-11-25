// The module's models, as the seed hands them to the shared index sync (design §10). `autoIndex` is
// off in production, and a folder's unique name index is the only race guard two people naming two
// folders alike meet — so the seed builds the indexes itself, FIRST, through the shared
// `syncDeclaredIndexes('apply', …)`. The sync never throws; each repository's `ensureCollection` is
// what refuses a write while its index is missing.
import { type Model } from 'mongoose';
import { ComplianceAccessModel } from './access-log/access.model';
import { ComplianceDocumentModel } from './documents/document.model';
import { ComplianceFolderModel } from './folders/folder.model';

export const complianceModels: Model<never>[] = [
  ComplianceFolderModel,
  ComplianceDocumentModel,
  ComplianceAccessModel,
] as unknown as Model<never>[];
