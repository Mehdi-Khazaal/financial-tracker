import { localDateStr } from './date';

describe('localDateStr', () => {
  it('formats a local date as YYYY-MM-DD', () => {
    const date = new Date(2026, 5, 12, 14, 30, 0);

    expect(localDateStr(date)).toBe('2026-06-12');
  });

  it('pads single-digit months and days', () => {
    const date = new Date(2026, 0, 3, 8, 15, 0);

    expect(localDateStr(date)).toBe('2026-01-03');
  });
});
