// One refused register write, ONE message — in the reader's language (review findings WEB-1 and
// LIVE-1). The global MutationCache handler (`shared/lib/query-client.ts`) toasts the server's own
// sentence — English — for every mutation that declares no `onError`; every register dialog
// already reports the refusal itself through `registerErrorText`. So each register hook must
// declare `onError`, and this drives the REAL hooks through the REAL query client to prove it:
// the API is mocked to refuse, and the global handler must stay silent.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../shared/lib/api-client';
import { queryClient } from '../../shared/lib/query-client';
import { toast } from '../../shared/ui/toast/toast-store';
import {
  useDeleteRegisterEntry,
  useHandoverRegisterEntry,
  useImportRegisterWorkbook,
  useLinkRegisterEntry,
  useReceivePendingRegisterEntry,
  useReceiveRegisterEntry,
  useRevealRegisterCombination,
  useUpdateRegisterEntry,
} from './api/register-queries';

const refusal = (): ApiError =>
  new ApiError('ATM_REGISTER_NOT_OPEN', 'the entry is not open', 409, undefined, 'req-spec');

vi.mock('./api/register-api', () => {
  const refuse = (): Promise<never> => Promise.reject(refusal());
  return {
    receiveRegisterEntry: refuse,
    updateRegisterEntry: refuse,
    receivePendingRegisterEntry: refuse,
    handoverRegisterEntry: refuse,
    linkRegisterEntry: refuse,
    deleteRegisterEntry: refuse,
    revealRegisterCombination: refuse,
    importRegisterWorkbook: refuse,
  };
});

/** Render once to get a hook's mutation, the way a dialog holds it. */
const held = <T,>(hook: () => T): T => {
  let result: T | undefined;
  const Probe = (): null => {
    result = hook();
    return null;
  };
  renderToStaticMarkup(
    createElement(QueryClientProvider, { client: queryClient }, createElement(Probe)),
  );
  if (result === undefined) throw new Error('the hook did not run');
  return result;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a refused register write is reported once, by its own dialog', () => {
  it.each([
    ['receive', () => held(useReceiveRegisterEntry).mutateAsync({} as never)],
    ['edit', () => held(useUpdateRegisterEntry).mutateAsync({ id: 'e1', body: {} as never })],
    [
      'receive pending',
      () => held(useReceivePendingRegisterEntry).mutateAsync({ id: 'e1', body: {} as never }),
    ],
    ['handover', () => held(useHandoverRegisterEntry).mutateAsync({ id: 'e1', body: {} as never })],
    ['link', () => held(useLinkRegisterEntry).mutateAsync({ id: 'e1', version: 1 })],
    ['delete', () => held(useDeleteRegisterEntry).mutateAsync({ id: 'e1', version: 1 })],
    ['reveal', () => held(useRevealRegisterCombination).mutateAsync('e1')],
    [
      'import',
      () =>
        held(useImportRegisterWorkbook).mutateAsync({
          file: {} as File,
          apply: [],
        }),
    ],
  ])('%s: the global handler raises no second, English toast', async (_name, run) => {
    const errors = vi.spyOn(toast, 'error').mockImplementation(() => 'toast');
    await expect(run()).rejects.toBeInstanceOf(ApiError);
    expect(errors).not.toHaveBeenCalled();
  });

  it('control: a mutation without its own onError IS toasted by the global handler', async () => {
    const errors = vi.spyOn(toast, 'error').mockImplementation(() => 'toast');
    await expect(
      queryClient
        .getMutationCache()
        .build(queryClient, { mutationFn: () => Promise.reject(refusal()) })
        .execute(undefined),
    ).rejects.toBeInstanceOf(ApiError);
    expect(errors).toHaveBeenCalledTimes(1);
  });
});
