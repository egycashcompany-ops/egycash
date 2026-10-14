// Uniform response envelope (API Standards §2) — implemented once, used by all controllers.
import { type Response } from 'express';
import { type ApiSuccess, type PageMeta, type Paginated } from '@ecms/contracts';

/** `meta` is a list's page block, or an action's own typed meta beside an unchanged `data`. */
export const ok = <T, M extends object = PageMeta>(res: Response, data: T, meta?: M): void => {
  const body: ApiSuccess<T, M> =
    meta === undefined ? { success: true, data } : { success: true, data, meta };
  res.status(200).json(body);
};

export const okPage = <T, D>(res: Response, page: Paginated<T>, map: (item: T) => D): void => {
  ok(res, page.items.map(map), page.meta);
};

export const created = <T>(res: Response, data: T, location?: string): void => {
  if (location !== undefined) res.location(location);
  const body: ApiSuccess<T> = { success: true, data };
  res.status(201).json(body);
};

export const noContent = (res: Response): void => {
  res.status(204).end();
};
