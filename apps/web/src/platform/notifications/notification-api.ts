// The in-app inbox endpoints, typed from the contracts.
import { type NotificationDto, type Paginated } from '@ecms/contracts';
import { buildQuery, del, get, getPage, post } from '../../shared/lib/api-client';

/**
 * The router is mounted at `/platform/notifications` (see `app.ts`), not `/notifications`.
 *
 * Getting this wrong is silent: every call 404s, the queries reject, and the bell renders its
 * empty state — indistinguishable from having no notifications. `notification-api-contract.spec`
 * checks this against the API source so it cannot drift again.
 */
const BASE = '/platform/notifications';

/** Just the badge. Its own endpoint because the bell asks for it far more often than the list. */
export const unreadNotificationCount = (): Promise<{ count: number }> =>
  get<{ count: number }>(`${BASE}/unread-count`);

export const listNotifications = (params: {
  page?: number;
  pageSize?: number;
  unreadOnly?: boolean;
}): Promise<Paginated<NotificationDto>> =>
  getPage<NotificationDto>(
    `${BASE}${buildQuery({
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 20,
      ...(params.unreadOnly === true ? { unreadOnly: true } : {}),
    })}`,
  );

export const markNotificationRead = (id: string): Promise<NotificationDto> =>
  post<NotificationDto>(`${BASE}/${id}/read`, {});

export const markAllNotificationsRead = (): Promise<{ count: number }> =>
  post<{ count: number }>(`${BASE}/read-all`, {});

/** Archive — the platform's delete. The row survives for audit; it leaves the inbox. */
export const archiveNotification = (id: string): Promise<void> => del<void>(`${BASE}/${id}`);
