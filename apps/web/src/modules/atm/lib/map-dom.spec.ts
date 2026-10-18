// The map's DOM pieces put every word through `textContent` (DM-27): a zone or machine name is text
// people typed, and a `divIcon` built from an HTML string would run it as markup.
import { describe, expect, it } from 'vitest';
import {
  VERTEX_SQUARE_CLASS,
  VERTEX_SQUARE_SELECTED_CLASS,
  clusterElement,
  clusterSizePx,
  closeShapeElement,
  tempPinElement,
  vertexHandleElement,
  zoneLabelElement,
  type DocLike,
  type ElementLike,
} from './map-dom';

interface FakeElement extends ElementLike {
  tag: string;
  children: FakeElement[];
  attributes: Record<string, string>;
  styles: Record<string, string>;
  /** What a browser would have parsed as markup — never written here. */
  innerHTML?: string;
}

const fakeDocument = (): DocLike => ({
  createElement: (tag: string): FakeElement => {
    const el: FakeElement = {
      tag,
      className: '',
      textContent: null,
      children: [],
      attributes: {},
      styles: {},
      style: { setProperty: (name, value) => void (el.styles[name] = value) },
      setAttribute: (name, value) => void (el.attributes[name] = value),
      appendChild: (child) => el.children.push(child as FakeElement),
    };
    return el;
  },
});

const allText = (el: FakeElement): string =>
  [el.textContent ?? '', ...el.children.map(allText)].join('');
const anyMarkup = (el: FakeElement): boolean =>
  el.innerHTML !== undefined || el.children.some(anyMarkup);

const HOSTILE = '<img src=x onerror=alert(1)>';

describe('names are text, never markup', () => {
  it('a zone label carries the name as text', () => {
    const label = zoneLabelElement(fakeDocument(), {
      name: HOSTILE,
      countText: '3',
      color: '#483bba',
      dir: 'rtl',
    }) as FakeElement;
    expect(allText(label)).toBe(`${HOSTILE} · 3`);
    expect(anyMarkup(label)).toBe(false);
    expect(label.attributes['dir']).toBe('rtl');
    expect(label.children[0]?.styles['background-color']).toBe('#483bba');
  });

  it('the temporary pin carries the machine code as text', () => {
    const pin = tempPinElement(fakeDocument(), HOSTILE) as FakeElement;
    expect(allText(pin)).toBe(HOSTILE);
    expect(anyMarkup(pin)).toBe(false);
  });

  it('a cluster and the close-shape tip carry their words as text', () => {
    const doc = fakeDocument();
    const bubble = clusterElement(doc, {
      countText: '٨',
      color: '#1f2937',
      sizePx: 32,
    }) as FakeElement;
    expect(bubble.textContent).toBe('٨');
    expect(bubble.styles['width']).toBe('32px');
    const tip = closeShapeElement(doc, 'إغلاق الشكل', 'rtl') as FakeElement;
    expect(tip.textContent).toBe('إغلاق الشكل');
  });
});

describe('the handles', () => {
  it('marks the selected vertex on the square it returns', () => {
    expect(vertexHandleElement(fakeDocument(), { selected: true }).square.className).toBe(
      VERTEX_SQUARE_SELECTED_CLASS,
    );
    expect(vertexHandleElement(fakeDocument(), { selected: false }).square.className).toBe(
      VERTEX_SQUARE_CLASS,
    );
  });

  it('sizes a cluster 28–40 px by its count', () => {
    expect(clusterSizePx(2)).toBeGreaterThanOrEqual(28);
    expect(clusterSizePx(5000)).toBe(40);
    expect(clusterSizePx(10)).toBeLessThan(clusterSizePx(1000));
  });
});
