// The anchor guard's decision (spec §9.4, §8.7): a plain same-origin anchor click is intercepted;
// modifier clicks, middle clicks, `target="_blank"`, `download` links and other origins are left
// alone — so are the page's own anchors and a link to the page already open.
import { describe, expect, it } from 'vitest';
import { interceptableHref, type GuardClickEvent } from './useUnsavedGuard';

const LOCATION = {
  href: 'https://ecms.example/atm/map?branch=b1',
  origin: 'https://ecms.example',
  pathname: '/atm/map',
  search: '?branch=b1',
};

const anchor = (href: string, attributes: Record<string, string> = {}) => {
  const all: Record<string, string> = { href, ...attributes };
  const el = {
    getAttribute: (name: string) => all[name] ?? null,
    hasAttribute: (name: string) => name in all,
  };
  return { el, target: { closest: (selector: string) => (selector === 'a[href]' ? el : null) } };
};

const click = (target: unknown, extra: Partial<GuardClickEvent> = {}): GuardClickEvent => ({
  defaultPrevented: false,
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  target,
  ...extra,
});

describe('interceptableHref', () => {
  it('intercepts a plain same-origin anchor click and returns the in-app path', () => {
    expect(interceptableHref(click(anchor('/hr/employees?x=1#top').target), LOCATION)).toBe(
      '/hr/employees?x=1#top',
    );
    expect(
      interceptableHref(click(anchor('https://ecms.example/it/tickets').target), LOCATION),
    ).toBe('/it/tickets');
  });

  it('leaves modifier clicks and middle clicks alone', () => {
    const { target } = anchor('/hr/employees');
    for (const extra of [
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { altKey: true },
    ]) {
      expect(interceptableHref(click(target, extra), LOCATION)).toBeNull();
    }
    expect(interceptableHref(click(target, { button: 1 }), LOCATION)).toBeNull();
    expect(interceptableHref(click(target, { defaultPrevented: true }), LOCATION)).toBeNull();
  });

  it('leaves target="_blank", download links and other origins alone', () => {
    expect(
      interceptableHref(click(anchor('/x', { target: '_blank' }).target), LOCATION),
    ).toBeNull();
    expect(interceptableHref(click(anchor('/x', { download: '' }).target), LOCATION)).toBeNull();
    expect(
      interceptableHref(click(anchor('https://www.google.com/maps?q=1,2').target), LOCATION),
    ).toBeNull();
    expect(interceptableHref(click(anchor('/x', { target: '_self' }).target), LOCATION)).toBe('/x');
  });

  it('leaves a click that is not on an anchor, the page’s own anchors and this page alone', () => {
    expect(interceptableHref(click({ closest: () => null }), LOCATION)).toBeNull();
    expect(interceptableHref(click(null), LOCATION)).toBeNull();
    const own = anchor('/atm/map/unlocated');
    expect(
      interceptableHref(click(own.target), LOCATION, { ownRoot: { contains: () => true } }),
    ).toBeNull();
    expect(interceptableHref(click(anchor('/atm/map?branch=b1#x').target), LOCATION)).toBeNull();
  });

  it('strips the router basename', () => {
    const at = { ...LOCATION, href: 'https://ecms.example/app/atm/map', pathname: '/app/atm/map' };
    expect(
      interceptableHref(click(anchor('/app/hr/employees').target), at, { basename: '/app' }),
    ).toBe('/hr/employees');
  });
});
