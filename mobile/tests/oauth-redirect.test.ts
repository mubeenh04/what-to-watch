/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { displayNameFor, friendlyOAuthError, parseOAuthRedirect, pickRedirectUrl } from '../src/lib/oauth-redirect';

test('reads tokens from the fragment (Expo Go URL)', () => {
  const r = parseOAuthRedirect('exp://192.168.1.20:8081/--/auth/callback#access_token=AAA&expires_in=3600&refresh_token=RRR&token_type=bearer');
  assert.deepEqual(r, { kind: 'tokens', accessToken: 'AAA', refreshToken: 'RRR' });
});

test('reads tokens from the installed-app URL', () => {
  const r = parseOAuthRedirect('whattowatch://auth/callback#access_token=A&refresh_token=R');
  assert.equal(r.kind, 'tokens');
});

test('reads a PKCE code from the query', () => {
  assert.deepEqual(parseOAuthRedirect('whattowatch://auth/callback?code=abc123'), { kind: 'code', code: 'abc123' });
});

test('reads errors from query or fragment', () => {
  const r = parseOAuthRedirect(
    'exp://x/--/auth/callback?error=server_error&error_code=identity_already_exists&error_description=Identity+is+already+linked+to+another+user',
  );
  assert.deepEqual(r, { kind: 'error', code: 'identity_already_exists', message: 'Identity is already linked to another user' });
  const f = parseOAuthRedirect('exp://x/--/auth/callback#error=access_denied&error_description=User%20cancelled');
  assert.equal(f.kind, 'error');
});

test('empty redirect', () => {
  assert.deepEqual(parseOAuthRedirect('exp://x/--/auth/callback'), { kind: 'empty' });
});

test('friendly errors', () => {
  assert.match(friendlyOAuthError('identity_already_exists', 'Identity is already linked to another user'), /different What to Watch account/);
  assert.match(friendlyOAuthError(null, 'Unsupported provider: provider is not enabled'), /Enable the Google provider/);
  assert.match(friendlyOAuthError('manual_linking_disabled', 'Manual linking is disabled'), /Allow manual linking/);
  assert.equal(friendlyOAuthError(null, 'Something odd'), 'Something odd');
});

test('display name prefers Google full name', () => {
  assert.equal(displayNameFor({ email: 'sam@example.com', user_metadata: { full_name: 'Sam Smith' } }), 'Sam Smith');
  assert.equal(displayNameFor({ email: 'sam@example.com', user_metadata: {} }), 'sam');
  assert.equal(displayNameFor({ email: null, user_metadata: null }), 'Me');
});

test('return address: keeps a good exp:// URL', () => {
  const u = 'exp://192.168.1.5:8081/--/auth/callback';
  assert.equal(pickRedirectUrl({ createdUrl: u, linkingUri: 'exp://192.168.1.5:8081/--/' }), u);
});

test('return address: Expo Go but createURL gave the app scheme', () => {
  assert.equal(
    pickRedirectUrl({ createdUrl: 'whattowatch://auth/callback', linkingUri: 'exp://192.168.1.5:8081/--/' }),
    'exp://192.168.1.5:8081/--/auth/callback',
  );
  assert.equal(
    pickRedirectUrl({ createdUrl: 'whattowatch://auth/callback', linkingUri: 'whattowatch://', expoGoHost: '10.0.0.2:8081' }),
    'exp://10.0.0.2:8081/--/auth/callback',
  );
  assert.equal(
    pickRedirectUrl({ createdUrl: 'whattowatch://auth/callback', linkingUri: 'exps://abc-anonymous-8081.exp.direct/--/' }),
    'exps://abc-anonymous-8081.exp.direct/--/auth/callback',
  );
});

test('return address: installed app keeps whattowatch://', () => {
  assert.equal(
    pickRedirectUrl({ createdUrl: 'whattowatch://auth/callback', linkingUri: 'whattowatch://', expoGoHost: null }),
    'whattowatch://auth/callback',
  );
});
