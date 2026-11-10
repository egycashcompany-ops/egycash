// The company ID card: what is printed on it, recording a print, and the print history.
//
// Reading the card's data returns the national ID in full — it is printed on the card — so it is
// fetched only when the card is actually opened, never kept between visits, and the server audits
// every read (see the API's `employee-id-card.ts`).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type EmployeeIdCardDataDto,
  type EmployeeIdCardPrintDto,
  type EmployeeIdCardSummaryDto,
} from '@ecms/contracts';
import { get, post } from '../../../../../shared/lib/api-client';
import { detailKey, listKey } from '../../../../../shared/lib/query-keys';

const MODULE = 'hr';
const FEATURE = 'employees';

export const idCardKey = (id: string): readonly unknown[] => [MODULE, 'employeeIdCard', id];
export const idCardPrintsKey = (id: string): readonly unknown[] => [
  MODULE,
  'employeeIdCardPrints',
  id,
];

export const getEmployeeIdCard = (id: string): Promise<EmployeeIdCardDataDto> =>
  get<EmployeeIdCardDataDto>(`/hr/employees/${id}/id-card`);

export const recordEmployeeIdCardPrint = (id: string): Promise<EmployeeIdCardSummaryDto> =>
  post<EmployeeIdCardSummaryDto>(`/hr/employees/${id}/id-card/prints`, {});

/** The receipt for the waiting card was printed — kept on the employee, so reopening keeps the step. */
export const recordEmployeeIdCardReceipt = (id: string): Promise<EmployeeIdCardSummaryDto> =>
  post<EmployeeIdCardSummaryDto>(`/hr/employees/${id}/id-card/receipts`, {});

/** HR confirms the employee signed the receipt and took the card — the only thing that counts a card. */
export const confirmEmployeeIdCardHandover = (id: string): Promise<EmployeeIdCardSummaryDto> =>
  post<EmployeeIdCardSummaryDto>(`/hr/employees/${id}/id-card/handovers`, {});

export const listEmployeeIdCardPrints = (id: string): Promise<EmployeeIdCardPrintDto[]> =>
  get<EmployeeIdCardPrintDto[]>(`/hr/employees/${id}/id-card/prints`);

/** The card's data, while the card is open. Not cached afterwards: it carries the full national ID. */
export const useEmployeeIdCard = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: idCardKey(id),
    queryFn: () => getEmployeeIdCard(id),
    enabled,
    gcTime: 0,
    staleTime: 0,
  });

export const useEmployeeIdCardPrints = (id: string, enabled = true) =>
  useQuery({
    queryKey: idCardPrintsKey(id),
    queryFn: () => listEmployeeIdCardPrints(id),
    enabled,
  });

/** Everything that shows the card's state: the list's icon, the profile, the history, the card. */
const useAfterIdCardWrite = (id: string) => {
  const qc = useQueryClient();
  return (): void => {
    void qc.invalidateQueries({ queryKey: listKey(MODULE, FEATURE) });
    void qc.invalidateQueries({ queryKey: detailKey(MODULE, FEATURE, id) });
    void qc.invalidateQueries({ queryKey: idCardPrintsKey(id) });
    void qc.invalidateQueries({ queryKey: idCardKey(id) });
  };
};

/** One print: recorded, and the card waits for its handover. Not a card yet. */
export const useRecordIdCardPrint = (id: string) => {
  const after = useAfterIdCardWrite(id);
  return useMutation({ mutationFn: () => recordEmployeeIdCardPrint(id), onSuccess: after });
};

/** The receipt printed: the card now waits for the employee. */
export const useRecordIdCardReceipt = (id: string) => {
  const after = useAfterIdCardWrite(id);
  return useMutation({ mutationFn: () => recordEmployeeIdCardReceipt(id), onSuccess: after });
};

/** The handover confirmed: the employee's card count moves by one. */
export const useConfirmIdCardHandover = (id: string) => {
  const after = useAfterIdCardWrite(id);
  return useMutation({ mutationFn: () => confirmEmployeeIdCardHandover(id), onSuccess: after });
};
