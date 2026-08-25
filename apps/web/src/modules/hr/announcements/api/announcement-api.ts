// The announcements endpoints, typed from the contracts.
import {
  type AnnouncementAudience,
  type AnnouncementDto,
  type AudiencePreviewDto,
  type CreateAnnouncement,
  type Paginated,
} from '@ecms/contracts';
import { buildQuery, getPage, post } from '../../../../shared/lib/api-client';

/**
 * Resolve an audience WITHOUT sending. The one call a sender should always make first: a filter
 * that quietly matches four thousand people, or nobody at all, is invisible from the form.
 */
export const previewAudience = (audience: AnnouncementAudience): Promise<AudiencePreviewDto> =>
  post<AudiencePreviewDto>('/hr/announcements/preview', { audience });

export const sendAnnouncement = (input: CreateAnnouncement): Promise<AnnouncementDto> =>
  post<AnnouncementDto>('/hr/announcements', input);

export const listAnnouncements = (page: number): Promise<Paginated<AnnouncementDto>> =>
  getPage<AnnouncementDto>(`/hr/announcements${buildQuery({ page, pageSize: 20 })}`);
