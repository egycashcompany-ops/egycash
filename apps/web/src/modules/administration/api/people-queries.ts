// The keeper picker's search (ADR-019 rule 5): the server is asked for what was typed, and the
// browser never holds the staff list. Asked only once something is typed and the reader may open it.
import { useQuery } from '@tanstack/react-query';
import { peopleSearchKey } from './administration-keys';
import * as api from './people-api';

export const usePeopleSearch = (search: string, enabled: boolean) =>
  useQuery({
    queryKey: peopleSearchKey(search),
    queryFn: () => api.searchPeople(search),
    enabled: enabled && search.trim() !== '',
    staleTime: 30_000,
  });
