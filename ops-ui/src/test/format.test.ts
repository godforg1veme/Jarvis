import { describe, expect, it } from 'vitest';
import { dateLabel } from '../format';

describe('Moscow display time', () => {
  it('keeps fixed UTC+3, date rollover and label', () => {
    expect(dateLabel('2026-10-18T20:46:00Z')).toContain('18.10');
    expect(dateLabel('2026-10-18T20:46:00Z')).toContain('23:46:00');
    expect(dateLabel('2026-10-18T21:01:00Z')).toContain('19.10');
    expect(dateLabel('2026-10-18T21:01:00Z')).toContain('00:01:00');
    expect(dateLabel('2000-06-01T00:00:00Z')).toContain('03:00:00');
    expect(dateLabel('2026-10-18T20:46:00Z')).toContain('МСК');
  });
  it('does not throw on absent or invalid timestamps', () => {
    expect(dateLabel(null)).toBe('нет данных');
    expect(dateLabel('invalid')).toBe('нет данных');
  });
});
