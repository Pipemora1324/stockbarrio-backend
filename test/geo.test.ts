import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { distanceKm, formatDistance, isInColombia } from '../src/geo.js';

describe('geo', () => {
  it('computes known distances between Colombian cities', () => {
    const bogota = { latitude: 4.711, longitude: -74.0721 };
    const medellin = { latitude: 6.2442, longitude: -75.5812 };
    assert.ok(Math.abs(distanceKm(bogota, medellin) - 240) < 5);
    assert.equal(distanceKm(bogota, bogota), 0);
  });

  it('computes short distances inside a city', () => {
    const chapinero = { latitude: 4.641, longitude: -74.0636 };
    const teusaquillo = { latitude: 4.6263, longitude: -74.0771 };
    assert.ok(Math.abs(distanceKm(chapinero, teusaquillo) - 2.2) < 0.2);
  });

  it('formats distances in Spanish style', () => {
    assert.equal(formatDistance(0.33), '350 m');
    assert.equal(formatDistance(2.345), '2,3 km');
  });

  it('detects coordinates outside Colombia', () => {
    assert.equal(isInColombia({ latitude: 4.64, longitude: -74.06 }), true);
    assert.equal(isInColombia({ latitude: -74.06, longitude: 4.64 }), false);
  });
});
