import { describe, expect, it } from 'vitest';
import {
  formatDisplayDate,
  formatDisplayDateTimeRange,
  formatDisplayTime,
  formatDueLabel,
} from './date-display.js';

describe('date display helpers', () => {
  it('formats date-only values as dd/MM/yyyy', () => {
    expect(formatDisplayDate('2026-04-02')).toBe('02/04/2026');
  });

  it('formats time values in 24h and 12h mode', () => {
    expect(formatDisplayTime('18:05', '24')).toBe('18:05');
    expect(formatDisplayTime('18:05', '12')).toBe('6:05 PM');
  });

  it('formats same-day and cross-day date ranges', () => {
    expect(
      formatDisplayDateTimeRange(
        {
          startDate: '2026-04-02',
          startTime: '09:00',
          endDate: '2026-04-02',
          endTime: '11:30',
        },
        '24',
      ),
    ).toBe('02/04/2026, 09:00 - 11:30');

    expect(
      formatDisplayDateTimeRange(
        {
          startDate: '2026-04-02',
          startTime: '22:00',
          endDate: '2026-04-03',
          endTime: '01:15',
        },
        '24',
      ),
    ).toBe('02/04/2026, 22:00 -> 03/04/2026, 01:15');
  });

  it('formats due labels without raw ISO strings', () => {
    expect(
      formatDueLabel(
        {
          date: '2026-04-04',
          time: '08:45',
        },
        '24',
      ),
    ).toBe('Due 04/04/2026, 08:45');
  });
});
