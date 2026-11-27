/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { activeFilterCount, formatWatched, releaseInfo, shortDate, letterboxdUrl, posterForCard, toCard, toScore, trimSynopsis, whereToWatch } from '../src/lib/format';
import { emptyFilters, type TitleRow } from '../src/lib/types';

const row = (over: Partial<TitleRow['title']> = {}, status: TitleRow['status'] = 'home'): TitleRow => ({
  title_id: 1,
  status,
  status_changed_at: '2026-11-26T10:00:00Z',
  watched_at: null,
  title: {
    title_id: 1,
    title_type: 'movie',
    name: 'Dune: Part Two',
    release_year: 2024,
    end_year: null,
    synopsis: 'Paul joins the Fremen.',
    poster_url: 'https://image.tmdb.org/t/p/w500/abc.jpg',
    imdb_rating: '8.5',
    metacritic_score: 79,
    letterboxd_url: null,
    title_genre: [
      { rank: 3, genre: { name: 'Drama' } },
      { rank: 1, genre: { name: 'Sci-Fi' } },
      { rank: 2, genre: { name: 'Adventure' } },
    ],
    title_cast: [
      { billing_order: 2, person: { name: 'Zendaya' } },
      { billing_order: 1, person: { name: 'Timothée Chalamet' } },
      { billing_order: 3, person: { name: 'Rebecca Ferguson' } },
    ],
    title_availability: [],
    ...over,
  },
});

test('synopsis is cut to 50 words', () => {
  const long = Array.from({ length: 80 }, (_, i) => `w${i},`).join(' ');
  const out = trimSynopsis(long);
  assert.equal(out.replace('…', '').split(' ').length, 50);
  assert.ok(out.endsWith('w49…'));
  assert.equal(trimSynopsis('  short   text '), 'short text');
  assert.equal(trimSynopsis(''), 'No synopsis available.');
});

test('scores handle strings and empty values', () => {
  assert.equal(toScore('7.9'), 7.9);
  assert.equal(toScore(64), 64);
  assert.equal(toScore(null), null);
  assert.equal(toScore(''), null);
  assert.equal(toScore('n/a'), null);
});

test('card shows top two genres and actors in order, and both scores', () => {
  const c = toCard(row());
  assert.deepEqual(c.genres, ['Sci-Fi', 'Adventure']);
  assert.deepEqual(c.cast, ['Timothée Chalamet', 'Zendaya']);
  assert.equal(c.imdb, 8.5);
  assert.equal(c.metacritic, 79);
});

test('missing scores, cast and genres do not break the card', () => {
  const c = toCard(row({ imdb_rating: null, metacritic_score: null, title_cast: null, title_genre: null }));
  assert.equal(c.imdb, null);
  assert.equal(c.metacritic, null);
  assert.deepEqual(c.cast, []);
  assert.deepEqual(c.genres, []);
});

test('posters use a card-sized TMDB image', () => {
  assert.equal(posterForCard('https://image.tmdb.org/t/p/w500/abc.jpg'), 'https://image.tmdb.org/t/p/w342/abc.jpg');
  assert.equal(posterForCard('https://image.tmdb.org/t/p/original/abc.jpg'), 'https://image.tmdb.org/t/p/w342/abc.jpg');
  assert.equal(posterForCard(null), null);
});

test('where to watch: streaming first, then drive; downloaded Home titles show the drive', () => {
  const both = whereToWatch(
    row({
      title_availability: [
        { source_type: 'local', watch_url: null, streaming_service: null, local_drive: { name: 'Media HDD' } },
        { source_type: 'streaming', watch_url: 'https://x', streaming_service: { name: 'Netflix', logo_url: null, display_order: 1 }, local_drive: null },
      ],
    }),
  );
  assert.deepEqual(both.map((w) => w.kind), ['streaming', 'local']);
  assert.deepEqual(whereToWatch(row({}, 'home')), [{ kind: 'local', name: 'Drive' }]);
  assert.deepEqual(whereToWatch(row({}, 'explore')), []);
});

test('Letterboxd link falls back to a search', () => {
  assert.equal(letterboxdUrl('Past Lives', null), 'https://letterboxd.com/search/Past%20Lives/');
  assert.equal(letterboxdUrl('X', 'https://letterboxd.com/tmdb/1'), 'https://letterboxd.com/tmdb/1');
});

test('watched dates read naturally', () => {
  const now = new Date(2026, 10, 26, 20, 0);
  assert.equal(formatWatched(new Date(2026, 10, 26, 9, 0).toISOString(), now), 'Watched today');
  assert.equal(formatWatched(new Date(2026, 10, 25, 23, 0).toISOString(), now), 'Watched yesterday');
  assert.equal(formatWatched(new Date(2026, 10, 1).toISOString(), now), 'Watched 1 Nov');
  assert.equal(formatWatched(new Date(2025, 0, 5).toISOString(), now), 'Watched 5 Jan 2025');
});

test('active filter count', () => {
  assert.equal(activeFilterCount(emptyFilters), 0);
  assert.equal(activeFilterCount({ ...emptyFilters, yearFrom: 2000, genreIds: [1, 2], location: 'local', imdbMin: 7, metacriticMin: 60 }), 6);
  assert.equal(activeFilterCount({ ...emptyFilters, releaseStatuses: ['in_cinemas', 'unknown'] }), 2);
});

test('release status line', () => {
  const now = new Date(2026, 10, 26);
  assert.equal(releaseInfo(row(), now), null);
  assert.deepEqual(
    releaseInfo(
      row({
        release_status: 'in_cinemas',
        next_release_type: 'digital',
        next_release_date: '2026-12-10',
        title_release: [
          { release_type: 'premiere', release_date: '2026-09-01' },
          { release_type: 'theatrical', release_date: '2026-11-14' },
          { release_type: 'digital', release_date: '2026-12-10' },
        ],
      }),
      now,
    ),
    { status: 'in_cinemas', label: 'In cinemas only', detail: 'Since 14 Nov · Digital on 10 Dec' },
  );
  assert.deepEqual(
    releaseInfo(row({ release_status: 'upcoming', next_release_type: 'theatrical', next_release_date: '2027-01-09' }), now),
    { status: 'upcoming', label: 'Coming 9 Jan 2027', detail: 'In cinemas' },
  );
  assert.deepEqual(releaseInfo(row({ release_status: 'physical', title_release: [] }), now), {
    status: 'physical',
    label: 'DVD/Blu-ray',
    detail: null,
  });
  assert.equal(shortDate('2025-03-02', now), '2 Mar 2025');
});

test('letterboxd links: movies by TMDB id, series and unknown ids by search', () => {
  assert.equal(letterboxdUrl('Dune', null, 693134, 'movie'), 'https://letterboxd.com/tmdb/693134/');
  assert.equal(letterboxdUrl('Dune', 'https://letterboxd.com/film/dune-part-two/', 693134, 'movie'), 'https://letterboxd.com/film/dune-part-two/');
  assert.equal(letterboxdUrl('Severance', null, 95396, 'series'), 'https://letterboxd.com/search/Severance/');
  assert.equal(letterboxdUrl('Past Lives', null, null, 'movie'), 'https://letterboxd.com/search/Past%20Lives/');
});

test('card carries the user rating', () => {
  assert.equal(toCard({ ...row(), user_rating: '3.5' }).rating, 3.5);
  assert.equal(toCard(row()).rating, null);
  assert.equal(toCard(row({ tmdb_id: 7 })).letterboxdUrl, 'https://letterboxd.com/tmdb/7/');
});
