import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SharedSky } from '../components/orbital/SharedSky';

const painter = vi.hoisted(() => ({ resize: vi.fn(), paint: vi.fn() }));
vi.mock('../components/orbital/skyParticlePainter', () => ({ createSkyPainter: () => painter }));

let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
function frame(now: number) {
  act(() => {
    const scheduled = [...frames.values()];
    frames.clear();
    scheduled.forEach((callback) => callback(now));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  frames = new Map(); nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('shared sky motion lifecycle', () => {
  it('stops all particle work on pause and resumes from its saved time', () => {
    const view = render(<SharedSky animate />);
    frame(0); frame(40); frame(80);
    const beforePause = painter.paint.mock.lastCall![0];
    expect(beforePause).toBeCloseTo(.16);
    view.rerender(<SharedSky animate={false} />);
    expect(frames.size).toBe(0);
    expect(view.container.firstElementChild?.getAttribute('data-motion')).toBe('paused');
    frame(60_000);
    expect(painter.paint.mock.lastCall![0]).toBe(beforePause);
    view.rerender(<SharedSky animate />);
    frame(60_000); frame(60_040);
    expect(painter.paint.mock.lastCall![0]).toBeCloseTo(.24);
  });

  it('freezes when hidden, preserves the frozen frame on resize and cancels on unmount', () => {
    const view = render(<SharedSky animate />);
    frame(0); frame(40);
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    fireEvent(document, new Event('visibilitychange'));
    expect(frames.size).toBe(0);
    expect(view.container.firstElementChild?.getAttribute('data-motion')).toBe('paused');
    fireEvent(window, new Event('resize'));
    expect(painter.paint.mock.lastCall![0]).toBeCloseTo(.08);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    fireEvent(document, new Event('visibilitychange'));
    expect(frames.size).toBe(1);
    view.unmount();
    expect(frames.size).toBe(0);
    const paints = painter.paint.mock.calls.length;
    fireEvent(window, new Event('resize'));
    expect(painter.paint).toHaveBeenCalledTimes(paints);
  });

  it('limits updates to 30 fps and bounds long stalls', () => {
    render(<SharedSky animate />);
    frame(0); frame(10); frame(20); frame(30);
    expect(painter.paint).toHaveBeenCalledTimes(1); // Initial still frame only.
    frame(40);
    expect(painter.paint).toHaveBeenCalledTimes(2);
    frame(10_000);
    expect(painter.paint.mock.lastCall![0]).toBeCloseTo(.28);
  });

  it('retains the star field when the image fails and supports an initially still sky', () => {
    const view = render(<SharedSky animate={false} />);
    expect(frames.size).toBe(0);
    expect(painter.paint).toHaveBeenCalledWith(0);
    fireEvent.error(view.container.querySelector('img')!);
    expect(view.container.querySelector('img')?.getAttribute('srcset')).toBeNull();
    expect(view.container.querySelector('img')).not.toBeNull();
    fireEvent.error(view.container.querySelector('img')!);
    expect(view.container.querySelector('img')).toBeNull();
    expect(view.container.querySelectorAll('canvas')).toHaveLength(1);
  });
});
