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

  it('is symmetric and stays finite for the farthest points', () => {
    const leticia = { latitude: -4.2153, longitude: -69.9406 };
    const sanAndres = { latitude: 12.5847, longitude: -81.7006 };
    assert.equal(distanceKm(leticia, sanAndres), distanceKm(sanAndres, leticia));
    assert.ok(Math.abs(distanceKm(leticia, sanAndres) - 2275) < 25);
    const antipode = distanceKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 180 });
    assert.ok(Math.abs(antipode - Math.PI * 6371) < 0.001);
  });

  it('shows meters below 1 km and never "1000 m"', () => {
    assert.equal(formatDistance(0), '50 m');
    assert.equal(formatDistance(0.974), '950 m');
    assert.equal(formatDistance(0.98), '1,0 km');
    assert.equal(formatDistance(0.999), '1,0 km');
    assert.equal(formatDistance(1.04), '1,0 km');
    assert.equal(formatDistance(12.06), '12,1 km');
  });

  it('accepts the far ends of the country, including the islands and the Amazon', () => {
    assert.equal(isInColombia({ latitude: 12.5847, longitude: -81.7006 }), true, 'San Andrés');
    assert.equal(isInColombia({ latitude: -4.2153, longitude: -69.9406 }), true, 'Leticia');
    assert.equal(isInColombia({ latitude: 0, longitude: 0 }), false);
    assert.equal(isInColombia({ latitude: 40.4168, longitude: -3.7038 }), false, 'Madrid');
  });
});
