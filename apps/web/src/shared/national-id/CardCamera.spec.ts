// `liveCameraSupported()` is the switch between the page's own live camera and the phone's camera
// app: when it says no, the camera button falls back to the capture input, which opens the camera
// app. On an iPhone it has to say no — there a page is given only the camera's video, which came
// out too small and soft to read — while Android and computers keep the live camera.
import { afterEach, describe, expect, it } from 'vitest';
import { liveCameraSupported } from './CardCamera';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const IPAD_AS_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

// The suite runs on node, where there is no window and no camera, so a browser with a working
// camera over https is stood up by hand and taken down again after each test.
const window0 = Object.getOwnPropertyDescriptor(globalThis, 'window');
const navigator0 = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

const browser = (userAgent: string, platform: string, maxTouchPoints: number): void => {
  Object.defineProperty(globalThis, 'window', {
    value: { isSecureContext: true },
    configurable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent, platform, maxTouchPoints, mediaDevices: { getUserMedia: () => undefined } },
    configurable: true,
  });
};

afterEach(() => {
  for (const [name, saved] of [
    ['window', window0],
    ['navigator', navigator0],
  ] as const) {
    if (saved === undefined) Reflect.deleteProperty(globalThis, name);
    else Object.defineProperty(globalThis, name, saved);
  }
});

describe('liveCameraSupported', () => {
  it('says no on an iPhone, so the camera button opens the camera app', () => {
    browser(IPHONE, 'iPhone', 5);
    expect(liveCameraSupported()).toBe(false);
  });

  it('says no on an iPad, which calls itself a Mac but answers to touch', () => {
    browser(IPAD_AS_MAC, 'MacIntel', 5);
    expect(liveCameraSupported()).toBe(false);
  });

  it('keeps the live camera on an Android phone', () => {
    browser(ANDROID, 'Linux armv8l', 5);
    expect(liveCameraSupported()).toBe(true);
  });

  it('keeps the live camera on a computer', () => {
    browser(IPAD_AS_MAC, 'MacIntel', 0);
    expect(liveCameraSupported()).toBe(true);
  });
});
