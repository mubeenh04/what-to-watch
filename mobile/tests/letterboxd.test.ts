/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildLetterboxdCsv, csvCell, normaliseRating } from '../src/lib/letterboxd';

test('ratings snap to half stars and reject out-of-range values', () => {
  assert.equal(normaliseRating(3.5), 3.5);
  assert.equal(normaliseRating(3.74), 3.5);
  assert.equal(normaliseRating(0), null);
  assert.equal(normaliseRating(5.5), null);
  assert.equal(normaliseRating(NaN), null);
});

test('csv cells are quoted and formula-safe', () => {
  assert.equal(csvCell('Dune: Part Two'), 'Dune: Part Two');
  assert.equal(csvCell('Say "hi", friend'), '"Say ""hi"", friend"');
  assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(csvCell(null), '');
});

test('export lists rated films in Letterboxd import columns, with no watched date', () => {
  const { csv, count } = buildLetterboxdCsv([
    { name: 'Zodiac', year: 2007, tmdbId: 1949, imdbId: 'tt0443706', rating: 4.5 },
    { name: 'Amélie, the film', year: 2001, tmdbId: null, imdbId: null, rating: 5 },
    { name: 'Unrated', year: 2000, tmdbId: 1, imdbId: null, rating: 0 },
  ]);
  assert.equal(count, 2);
  assert.equal(
    csv,
    'tmdbID,imdbID,Title,Year,Rating\r\n,,"Amélie, the film",2001,5.0\r\n1949,tt0443706,Zodiac,2007,4.5\r\n',
  );
});
