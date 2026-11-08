// «الرسائل التلقائية»'s client: one read, one save, one test. Its own file, as every system-admin
// surface has its own client.
//
// The token only ever travels TOWARD the server: it is sent on a save and never read back
// (`MessagingSettingsDto.sms.tokenSet` says whether one is stored), so no answer here can carry it.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type MessagingSettingsDto,
  type SmsTestResultDto,
  type TestSms,
  type UpdateMessagingSettingsInput,
} from '@ecms/contracts';
import { get, patch, post } from '../../../../shared/lib/api-client';

/** The key the realtime registry refreshes (`platform.messagingConfig`). */
export const messagingSettingsKey = (): readonly unknown[] => ['platform', 'messaging', 'settings'];

export const getMessagingSettings = (): Promise<MessagingSettingsDto> =>
  get<MessagingSettingsDto>('/platform/messaging/settings');

/** Only what changes; in `sms`, `token` omitted keeps the stored one and `null` clears it. */
export const updateMessagingSettings = (
  body: UpdateMessagingSettingsInput,
): Promise<MessagingSettingsDto> =>
  patch<MessagingSettingsDto>('/platform/messaging/settings', body);

/** «رسالة تجريبية من نظام ECMS.» to the number given, with the STORED settings. */
export const testSms = (body: TestSms): Promise<SmsTestResultDto> =>
  post<SmsTestResultDto>('/platform/messaging/sms/test', body);

export const useMessagingSettings = () =>
  useQuery({ queryKey: messagingSettingsKey(), queryFn: () => getMessagingSettings() });

export const useUpdateMessagingSettings = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateMessagingSettingsInput) => updateMessagingSettings(body),
    onSuccess: (saved) => {
      client.setQueryData(messagingSettingsKey(), saved);
    },
  });
};

export const useTestSms = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: TestSms) => testSms(body),
    onSuccess: (run) => {
      // The run is the settings' last-test line now; show it without waiting for a refetch.
      client.setQueryData<MessagingSettingsDto>(messagingSettingsKey(), (current) =>
        current === undefined ? current : { ...current, sms: { ...current.sms, lastTest: run } },
      );
    },
  });
};
