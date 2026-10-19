import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addDays, daysBetween, todayInBogota } from '../src/dates.js';

describe('dates', () => {
  it('uses the Bogota calendar day even when UTC is already the next day', () => {
    assert.equal(todayInBogota(new Date('2026-10-19T03:30:00Z')), '2026-10-18');
    assert.equal(todayInBogota(new Date('2026-10-19T05:30:00Z')), '2026-10-19');
  });

  it('adds days across month and year boundaries', () => {
    assert.equal(addDays('2026-12-30', 3), '2027-01-02');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  });

  it('counts calendar days between two dates', () => {
    assert.equal(daysBetween('2026-10-18', '2026-10-21'), 3);
    assert.equal(daysBetween('2026-10-18', '2026-10-17'), -1);
  });
});
