import type { UserIdentity } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { friendlyOAuthError, parseOAuthRedirect, pickRedirectUrl } from './oauth-redirect';
import { supabase } from './supabase';

// Closes the browser popup on web; does nothing on phones.
WebBrowser.maybeCompleteAuthSession();

/**
 * Where Supabase sends the phone back to after Google.
 * Expo Go: exp://<your Mac's address>:8081/--/auth/callback (changes with your Wi-Fi address).
 * Installed app: whattowatch://auth/callback.
 * Both are covered by adding exp://** and whattowatch://** to Supabase's Redirect URLs.
 */
export function authRedirectUrl(): string {
  const expoGo = Constants.expoGoConfig as { debuggerHost?: string } | null;
  return pickRedirectUrl({
    createdUrl: Linking.createURL('auth/callback'),
    linkingUri: Constants.linkingUri,
    // Only Expo Go has expoGoConfig (this project has no development-client builds).
    expoGoHost: expoGo ? (Constants.expoConfig?.hostUri ?? expoGo.debuggerHost ?? null) : null,
  });
}

export type GoogleResult = { ok: true } | { ok: false; cancelled?: boolean; message: string };

async function runBrowser(url: string, redirectTo: string): Promise<GoogleResult> {
  if (__DEV__) console.log(`[google-auth] return address: ${redirectTo}`);
  const result = await WebBrowser.openAuthSessionAsync(url, redirectTo);
  if (result.type !== 'success') return { ok: false, cancelled: true, message: 'Google sign-in was cancelled.' };

  const parsed = parseOAuthRedirect(result.url);
  if (parsed.kind === 'error') return { ok: false, message: friendlyOAuthError(parsed.code, parsed.message) };
  if (parsed.kind === 'tokens') {
    const { error } = await supabase.auth.setSession({
      access_token: parsed.accessToken,
      refresh_token: parsed.refreshToken,
    });
    return error ? { ok: false, message: error.message } : { ok: true };
  }
  if (parsed.kind === 'code') {
    const { error } = await supabase.auth.exchangeCodeForSession(parsed.code);
    return error ? { ok: false, message: error.message } : { ok: true };
  }
  return { ok: false, message: 'Google did not send the app a sign-in. Please try again.' };
}

/**
 * Sign in or sign up with Google. A new Google user gets a new account; a Google account whose
 * email matches an existing confirmed What to Watch account is joined to that account by Supabase,
 * so the existing lists are kept.
 */
export async function signInWithGoogle(): Promise<GoogleResult> {
  const redirectTo = authRedirectUrl();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } },
  });
  if (error || !data?.url) return { ok: false, message: friendlyOAuthError(null, error?.message ?? 'Could not start Google sign-in.') };
  return runBrowser(data.url, redirectTo);
}

/**
 * Adds Google to the signed-in account (any Google address, not only one matching the email).
 * The account and its lists stay the same; afterwards either sign-in method opens it.
 */
export async function linkGoogle(): Promise<GoogleResult> {
  const redirectTo = authRedirectUrl();
  const { data, error } = await supabase.auth.linkIdentity({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } },
  });
  if (error || !data?.url) return { ok: false, message: friendlyOAuthError(null, error?.message ?? 'Could not start linking.') };
  const res = await runBrowser(data.url, redirectTo);
  if (res.ok) await supabase.auth.refreshSession(); // picks up the new identity on the user object
  return res;
}

export async function listIdentities(): Promise<UserIdentity[]> {
  const { data, error } = await supabase.auth.getUserIdentities();
  if (error) throw error;
  return data?.identities ?? [];
}

/** Removes Google from the account. Supabase refuses if it is the only way left to sign in. */
export async function unlinkGoogle(identity: UserIdentity): Promise<GoogleResult> {
  const { error } = await supabase.auth.unlinkIdentity(identity);
  if (error) return { ok: false, message: error.message };
  await supabase.auth.refreshSession();
  return { ok: true };
}
