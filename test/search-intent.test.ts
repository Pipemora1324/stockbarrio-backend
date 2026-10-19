import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseIntent, searchStem, singularize } from '../src/services/search-intent.js';

describe('parseIntent', () => {
  it('understands "busco huevos baratos"', () => {
    assert.deepEqual(parseIntent('busco huevos baratos'), { terms: ['huevo'], preference: 'cheapest', wantsNearby: false });
  });

  it('understands "leche cerca de mí" with accents and punctuation', () => {
    assert.deepEqual(parseIntent('¿Leche cerca de mí?'), { terms: ['leche'], preference: 'nearest', wantsNearby: true });
  });

  it('keeps the nearby wish when another preference wins', () => {
    assert.deepEqual(parseIntent('el pan más barato cerca de mí'), { terms: ['pan'], preference: 'cheapest', wantsNearby: true });
  });

  it('detects expiring, best deal and best grade preferences', () => {
    assert.equal(parseIntent('yogur por vencer').preference, 'expiring');
    assert.equal(parseIntent('queso en oferta').preference, 'best_deal');
    assert.deepEqual(parseIntent('huevos de la mejor categoría'), { terms: ['huevo'], preference: 'best_grade', wantsNearby: false });
  });

  it('detects a known neighborhood and removes it from the terms', () => {
    assert.deepEqual(parseIntent('quiero arepas en Laureles', ['Chapinero', 'Laureles']), { terms: ['arepa'], preference: 'relevance', wantsNearby: false, neighborhood: 'Laureles' });
  });

  it('keeps several product words', () => {
    assert.deepEqual(parseIntent('necesito leche deslactosada').terms, ['leche', 'deslactosada']);
  });
});

describe('searchStem', () => {
  it('matches masculine and feminine forms of longer words', () => {
    assert.deepEqual(['asada', 'asado', 'leche', 'papa', 'huevo'].map(searchStem), ['asad', 'asad', 'leche', 'papa', 'huev']);
  });
});

describe('singularize', () => {
  it('turns common Spanish plurals into singular', () => {
    assert.deepEqual(['huevos', 'panes', 'arepas', 'quesos', 'nueces', 'pan', 'gas'].map(singularize), ['huevo', 'pan', 'arepa', 'queso', 'nuez', 'pan', 'gas']);
  });
});
