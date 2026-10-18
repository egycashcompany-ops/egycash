// The mounted flag a page-leaving loop checks (§8.10): StrictMode's development remount — mount,
// cleanup, mount — must leave it true, or «بدء التحويل» stops after one call and spins forever.
import { describe, expect, it } from 'vitest';
import { trackMounted } from './useMountedRef';

describe('trackMounted', () => {
  it('is true after StrictMode’s mount, cleanup and second mount', () => {
    const ref = { current: true };
    const effect = trackMounted(ref);
    const firstCleanup = effect();
    firstCleanup();
    expect(ref.current).toBe(false);
    effect();
    expect(ref.current).toBe(true);
  });

  it('is false once the component is really gone', () => {
    const ref = { current: true };
    trackMounted(ref)()();
    expect(ref.current).toBe(false);
  });
});
