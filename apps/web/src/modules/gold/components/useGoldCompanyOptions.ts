// The owner list every gold filter and picker offers.
//
// One hook so the option list is fetched once per screen and looks the same everywhere. It reads a
// generous page because the owner list is a bounded catalog (companies, funds and institutions the
// business has contracts with), not a growth collection.
import { useMemo } from 'react';
import { useGoldCompanies } from '../api/gold-queries';

export interface Option {
  value: string;
  label: string;
}

export const useGoldCompanyOptions = (type?: 'fund'): Option[] => {
  const { data } = useGoldCompanies({ pageSize: 100, type });
  return useMemo(
    () => (data?.items ?? []).map((company) => ({ value: company.id, label: company.name })),
    [data],
  );
};
