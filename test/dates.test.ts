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

  it('changes day exactly at midnight in Bogota (05:00 UTC)', () => {
    assert.equal(todayInBogota(new Date('2026-10-19T04:59:59.999Z')), '2026-10-18');
    assert.equal(todayInBogota(new Date('2026-10-19T05:00:00.000Z')), '2026-10-19');
    assert.equal(todayInBogota(new Date('2027-01-01T04:00:00Z')), '2026-12-31', 'new year is still the old year in Bogota');
  });

  it('handles leap years', () => {
    assert.equal(addDays('2028-02-28', 1), '2028-02-29');
    assert.equal(addDays('2027-02-28', 1), '2027-03-01');
    assert.equal(daysBetween('2028-02-01', '2028-03-01'), 29);
    assert.equal(daysBetween('2026-01-01', '2027-01-01'), 365);
  });

  it('counts the same day as zero', () => {
    assert.equal(daysBetween('2026-10-18', '2026-10-18'), 0);
    assert.equal(addDays('2026-10-18', 0), '2026-10-18');
  });
});
