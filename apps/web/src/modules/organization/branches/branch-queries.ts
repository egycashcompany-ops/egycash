// Branch-only query hooks. The CRUD/list/status hooks come from the shared factory
// (`branchConfig.queries`); this adds the super-admin Branch-Code change, seeding the detail cache
// and invalidating the branches subtree on success.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ChangeBranchCode } from '@ecms/contracts';
import { detailKey, featureKey } from '../../../shared/lib/query-keys';
import { ORG_MODULE } from '../shared/org-unit-resource';
import { changeBranchCode } from './branch-api';

const FEATURE = 'branches';

export const useChangeBranchCode = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ChangeBranchCode) => changeBranchCode(id, body),
    onSuccess: (doc) => {
      qc.setQueryData(detailKey(ORG_MODULE, FEATURE, doc.id), doc);
      void qc.invalidateQueries({ queryKey: featureKey(ORG_MODULE, FEATURE) });
    },
  });
};
