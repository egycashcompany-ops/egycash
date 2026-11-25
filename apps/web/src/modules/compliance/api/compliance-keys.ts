// The module's query keys (ADR-013): `['compliance', feature, kind, params]`, so a write invalidates
// exactly its own subtree. The realtime rows repeat the prefixes as literals
// (`platform/realtime/invalidation-registry.ts` imports nothing).
import { detailKey, featureKey, listKey } from '../../../shared/lib/query-keys';

export const COMPLIANCE_MODULE = 'compliance';

export const complianceKeys = {
  /** The shelf, each folder, and each folder's files — one subtree, since a file counts on its folder. */
  folders: featureKey(COMPLIANCE_MODULE, 'folders'),
  /** The sharing picker's searches. */
  people: featureKey(COMPLIANCE_MODULE, 'people'),
} as const;

export const folderListKey = (params: object): readonly unknown[] =>
  listKey(COMPLIANCE_MODULE, 'folders', params);

export const folderKey = (id: string): readonly unknown[] =>
  detailKey(COMPLIANCE_MODULE, 'folders', id);

export const folderDocumentsKey = (id: string): readonly unknown[] => [
  ...folderKey(id),
  'documents',
];

/** One file's seen report — under `folders`, so a write to its folder reads it again. */
export const seenReportKey = (documentId: string): readonly unknown[] => [
  COMPLIANCE_MODULE,
  'folders',
  'seen',
  documentId,
];

export const peopleSearchKey = (search: string): readonly unknown[] =>
  listKey(COMPLIANCE_MODULE, 'people', { search });
