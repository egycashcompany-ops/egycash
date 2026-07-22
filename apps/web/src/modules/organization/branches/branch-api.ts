// Branch-specific api surface. CRUD/status is served by the shared org-unit factory
// (`branchConfig.queries`); this adds the one branch-only endpoint: the super-admin Branch-Code
// correction (ADR-017). Everything else reuses the platform `/platform/branches` routes.
import { type BranchDto, type ChangeBranchCode } from '@ecms/contracts';
import { patch } from '../../../shared/lib/api-client';

export const changeBranchCode = (id: string, body: ChangeBranchCode): Promise<BranchDto> =>
  patch<BranchDto>(`/platform/branches/${id}/code`, body);
