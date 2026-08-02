// Platform settings surface (ADR-015 hierarchy): definitions (admin metadata), the caller's
// resolved values, and the scoped set endpoint. First consumed by the Fleet settings screen;
// any module's settings page reads the same three calls — values always come from the server's
// resolution, never from constants in the client.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type ResolvedSettingDto,
  type SetSetting,
  type SettingDefinitionDto,
} from '@ecms/contracts';
import { api, get } from '../../shared/lib/api-client';

const listSettingDefinitions = (): Promise<SettingDefinitionDto[]> =>
  get<SettingDefinitionDto[]>('/platform/settings/definitions');
const resolveMySettings = (): Promise<ResolvedSettingDto[]> =>
  get<ResolvedSettingDto[]>('/platform/settings/me');
const setSettingValue = (body: SetSetting): Promise<void> =>
  api<void>('/platform/settings/values', { method: 'PATCH', body: JSON.stringify(body) });

const SETTINGS_KEY = ['platform', 'settings'] as const;

/** Definitions carry descriptions + code defaults — `setting.view` guards them server-side. */
export const useSettingDefinitions = (enabled = true) =>
  useQuery({
    queryKey: [...SETTINGS_KEY, 'definitions'],
    queryFn: listSettingDefinitions,
    staleTime: 60_000,
    enabled,
  });

/** The caller's RESOLVED values (user → branch → organization → default). */
export const useMySettings = () =>
  useQuery({ queryKey: [...SETTINGS_KEY, 'me'], queryFn: resolveMySettings });

/**
 * Write one setting value. `onSettled` lets the calling module also invalidate whatever ITS
 * server-derived caches depend on the changed key (the platform cannot know that).
 */
export const useSetSetting = (onSuccessExtra?: () => void) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SetSetting) => setSettingValue(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: SETTINGS_KEY });
      onSuccessExtra?.();
    },
  });
};
