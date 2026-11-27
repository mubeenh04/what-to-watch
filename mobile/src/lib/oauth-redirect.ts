// Pure helpers for the URL Supabase sends the phone back to after Google sign-in or linking.
// Kept free of React Native imports so tests/ can run them under Node.

export type OAuthRedirect =
  | { kind: 'tokens'; accessToken: string; refreshToken: string }
  | { kind: 'code'; code: string }
  | { kind: 'error'; code: string | null; message: string }
  | { kind: 'empty' };

function params(part: string): URLSearchParams {
  return new URLSearchParams(part.replace(/^[?#]/, ''));
}

/**
 * Reads tokens (implicit flow, in the #fragment), a PKCE code (in the ?query) or an error (either)
 * out of the redirect URL. Works with exp://… (Expo Go) and whattowatch://… (installed app) URLs.
 */
export function parseOAuthRedirect(url: string): OAuthRedirect {
  const hashAt = url.indexOf('#');
  const beforeHash = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const fragment = params(hashAt >= 0 ? url.slice(hashAt + 1) : '');
  const queryAt = beforeHash.indexOf('?');
  const query = params(queryAt >= 0 ? beforeHash.slice(queryAt + 1) : '');
  const get = (k: string) => fragment.get(k) ?? query.get(k);

  const err = get('error_description') ?? get('error');
  if (err) return { kind: 'error', code: get('error_code') ?? get('error'), message: err.replace(/\+/g, ' ') };

  const accessToken = get('access_token');
  const refreshToken = get('refresh_token');
  if (accessToken && refreshToken) return { kind: 'tokens', accessToken, refreshToken };

  const code = get('code');
  if (code) return { kind: 'code', code };
  return { kind: 'empty' };
}

/** Turns Supabase's error text into something a person can act on. */
export function friendlyOAuthError(code: string | null, message: string): string {
  const c = (code ?? '').toLowerCase();
  const m = message.toLowerCase();
  if (c === 'identity_already_exists' || m.includes('already linked') || m.includes('already exists'))
    return 'That Google account is already used by a different What to Watch account. Sign in with Google to use that account, or pick another Google account to link.';
  if (c === 'manual_linking_disabled' || m.includes('manual linking'))
    return 'Linking Google accounts is switched off in Supabase. Turn on "Allow manual linking" under Authentication → Sign In / Providers.';
  if (m.includes('provider is not enabled') || m.includes('unsupported provider'))
    return 'Google sign-in is not switched on yet. Enable the Google provider in Supabase under Authentication → Sign In / Providers.';
  if (m.includes('redirect') && (m.includes('not allowed') || m.includes('invalid')))
    return 'Supabase did not accept the app\'s return address. Add exp://** and whattowatch://** under Authentication → URL Configuration → Redirect URLs.';
  if (c === 'access_denied' || m.includes('access_denied') || m.includes('denied')) return 'Google sign-in was cancelled.';
  return message;
}

/** A display name for a new profile: Google's full name if we have one, else the email's first part. */
export function displayNameFor(user: { email?: string | null; user_metadata?: Record<string, unknown> | null }): string {
  const md = user.user_metadata ?? {};
  const pick = (k: string) => (typeof md[k] === 'string' && (md[k] as string).trim() ? (md[k] as string).trim() : null);
  return (pick('display_name') || pick('full_name') || pick('name') || user.email?.split('@')[0] || 'Me').slice(0, 100);
}

/**
 * The address Supabase should send the phone back to after Google.
 * Expo Go only reopens through exp:// (its linkingUri looks like exp://192.168.1.5:8081/--/), and on
 * some Expo Go versions expo-linking's createURL wrongly returns the app's own scheme
 * (whattowatch://), which Expo Go can't open: the browser then spins forever. So when we can see
 * an Expo Go address we build the return address from it; otherwise we use createURL's answer.
 */
export function pickRedirectUrl(opts: {
  createdUrl: string;
  linkingUri?: string | null;
  expoGoHost?: string | null;
  path?: string;
}): string {
  const path = (opts.path ?? 'auth/callback').replace(/^\//, '');
  if (/^exps?:\/\//.test(opts.createdUrl)) return opts.createdUrl;
  const lu = opts.linkingUri ?? '';
  const m = lu.match(/^(exps?:\/\/[^/?#]+)/);
  if (m) return `${m[1]}/--/${path}`;
  if (opts.expoGoHost) return `exp://${opts.expoGoHost.replace(/\/.*$/, '')}/--/${path}`;
  return opts.createdUrl;
}
