import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cleanTvCode, formatTvCode, tvSignInLink } from '../src/lib/tv-code';

test('cleanTvCode accepts what people type', () => {
  assert.equal(cleanTvCode('k7p 4qx'), 'K7P4QX');
  assert.equal(cleanTvCode('K7P-4QX'), 'K7P4QX');
  assert.equal(cleanTvCode(' k7p4qx99 '), 'K7P4QX');
});

test('formatTvCode splits the code in two', () => {
  assert.equal(formatTvCode('K7P4QX'), 'K7P 4QX');
  assert.equal(formatTvCode('K7P'), 'K7P');
});

test('tvSignInLink opens the phone app on the approve screen', () => {
  assert.equal(tvSignInLink('K7P4QX'), 'whattowatch://tv-sign-in?code=K7P4QX');
});
