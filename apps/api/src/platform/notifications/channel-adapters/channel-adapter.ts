// The channel-adapter extension point (Sprint 3.3 plan §2) — the same shape as
// `registerFileProcessor` (Sprint 3.1). Every channel, including the two required
// ones, goes through this interface; `notify()` and its callers never see SMTP or a
// carrier API directly. Adding `sms`/`push`/`whatsapp` later is a new adapter file,
// zero changes to `notify()`.
import { type NotificationDoc } from '../notification.model';
import { type RenderedTemplate } from '../notification.rendering';

export interface ChannelSendResult {
  ok: boolean;
  error?: string;
}

export interface ChannelAdapter {
  id: string;
  send(notification: NotificationDoc, rendered: RenderedTemplate): Promise<ChannelSendResult>;
}

const adapters = new Map<string, ChannelAdapter>();

export const registerChannelAdapter = (adapter: ChannelAdapter): void => {
  if (adapters.has(adapter.id)) {
    throw new Error(`duplicate channel adapter: ${adapter.id}`);
  }
  adapters.set(adapter.id, adapter);
};

export const getChannelAdapter = (id: string): ChannelAdapter | undefined => adapters.get(id);

/** Test-only. */
export const clearChannelAdapters = (): void => {
  adapters.clear();
};
