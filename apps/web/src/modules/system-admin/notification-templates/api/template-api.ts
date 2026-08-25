// The notification-template catalog's client surface (P10).
//
// Every call here already existed and was already authorized and audited — the catalog has been
// complete since Sprint 3.3, which named "the administration console (template management UI)" as
// deliberately out of scope. This slice adds the surface and nothing else: no endpoint, no
// permission, no setting, no model.
//
// **Nothing is cached across a write.** Every mutation publishes a NEW VERSION rather than editing
// one, so the id a screen is holding stops being the latest the moment a save succeeds. The
// mutations therefore invalidate the whole subtree and hand the caller the new version's id.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type CreateNotificationTemplate,
  type ListNotificationTemplatesQuery,
  type NotificationTemplateDto,
  type Paginated,
  type PreviewNotificationTemplate,
  type RenderedTemplateDto,
  type TestSendNotificationTemplate,
  type UpdateNotificationTemplate,
} from '@ecms/contracts';
import { api, get, getPage } from '../../../../shared/lib/api-client';

const BASE = '/platform/notification-templates';

export const TEMPLATES_KEY = ['platform', 'notification-templates'] as const;

const listTemplates = (
  query: Partial<ListNotificationTemplatesQuery>,
): Promise<Paginated<NotificationTemplateDto>> => {
  const params = new URLSearchParams();
  if (query.page !== undefined) params.set('page', String(query.page));
  if (query.pageSize !== undefined) params.set('pageSize', String(query.pageSize));
  if (query.status !== undefined) params.set('status', query.status);
  if (query.category !== undefined) params.set('category', query.category);
  const suffix = params.toString();
  return getPage<NotificationTemplateDto>(suffix === '' ? BASE : `${BASE}?${suffix}`);
};

export const useTemplates = (query: Partial<ListNotificationTemplatesQuery>) =>
  useQuery({
    queryKey: [...TEMPLATES_KEY, 'list', query],
    queryFn: () => listTemplates(query),
  });

export const useTemplate = (id: string) =>
  useQuery({
    queryKey: [...TEMPLATES_KEY, 'detail', id],
    queryFn: () => get<NotificationTemplateDto>(`${BASE}/${id}`),
    enabled: id !== '',
  });

/** Every version of the key this id belongs to, newest first as the API returns them. */
export const useTemplateVersions = (id: string, enabled = true) =>
  useQuery({
    queryKey: [...TEMPLATES_KEY, 'versions', id],
    queryFn: () => get<NotificationTemplateDto[]>(`${BASE}/${id}/versions`),
    enabled: enabled && id !== '',
  });

export const useCreateTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateNotificationTemplate) =>
      api<NotificationTemplateDto>(BASE, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: TEMPLATES_KEY }),
  });
};

/**
 * An edit publishes a new version, so the response is a DIFFERENT template id than the one that
 * was edited. Callers navigate to it rather than assuming the id they held is still current.
 */
export const useUpdateTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateNotificationTemplate }) =>
      api<NotificationTemplateDto>(`${BASE}/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: TEMPLATES_KEY }),
  });
};

/** Deactivation — itself a new version (`status: inactive`), never a hard delete. */
export const useDeactivateTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<NotificationTemplateDto>(`${BASE}/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: TEMPLATES_KEY }),
  });
};

/** Renders against sample data and sends nothing — no cache to invalidate. */
export const usePreviewTemplate = () =>
  useMutation({
    mutationFn: ({ id, body }: { id: string; body: PreviewNotificationTemplate }) =>
      api<RenderedTemplateDto>(`${BASE}/${id}/preview`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  });

/** Sends a real message, to the caller alone. Audited server-side since P10. */
export const useTestSendTemplate = () =>
  useMutation({
    mutationFn: ({ id, body }: { id: string; body: TestSendNotificationTemplate }) =>
      api<void>(`${BASE}/${id}/test`, { method: 'POST', body: JSON.stringify(body) }),
  });
