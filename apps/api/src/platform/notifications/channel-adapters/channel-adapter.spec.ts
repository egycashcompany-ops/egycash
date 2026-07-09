// The channel-adapter registry (Sprint 3.3 plan §2) — same shape as file processors.
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearChannelAdapters,
  getChannelAdapter,
  registerChannelAdapter,
  type ChannelAdapter,
} from './channel-adapter';

const stub = (id: string): ChannelAdapter => ({
  id,
  send: () => Promise.resolve({ ok: true }),
});

afterEach(() => {
  clearChannelAdapters();
});

describe('channel adapter registry', () => {
  it('registers and looks up an adapter by id', () => {
    registerChannelAdapter(stub('inApp'));
    expect(getChannelAdapter('inApp')?.id).toBe('inApp');
  });

  it('returns undefined for an unregistered id', () => {
    expect(getChannelAdapter('sms')).toBeUndefined();
  });

  it('rejects a duplicate id registration', () => {
    registerChannelAdapter(stub('email'));
    expect(() => registerChannelAdapter(stub('email'))).toThrow(/duplicate channel adapter/);
  });
});
