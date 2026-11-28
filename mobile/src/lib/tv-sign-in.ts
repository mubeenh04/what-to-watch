// Sign the TV in from a phone. Server side: supabase/functions/tv-sign-in.
import { SUPABASE_KEY, SUPABASE_URL } from './config';
import { supabase } from './supabase';

const FN = () => `${SUPABASE_URL}/functions/v1/tv-sign-in`;

export class TvSignInUnavailable extends Error {
  constructor() {
    super("Phone sign-in isn't set up yet. Use email and password for now.");
  }
}

async function call<T>(body: Record<string, unknown>, accessToken?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(FN(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${accessToken ?? SUPABASE_KEY}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('No connection. Check the internet and try again.');
  }
  // 404 from the gateway means the function hasn't been deployed.
  if (res.status === 404 && body.action === 'start') throw new TvSignInUnavailable();
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `Sign-in failed (${res.status}).`);
  return data;
}

export type TvCode = { code: string; secret: string; expires_in: number; interval: number };

/** TV: get a new code to show. */
export const startTvSignIn = () => call<TvCode>({ action: 'start' });

/** TV: check whether the phone approved the code. On approval the TV is signed in. */
export async function pollTvSignIn(secret: string): Promise<'pending' | 'expired' | 'signed-in'> {
  const res = await call<{ status: 'pending' | 'expired' | 'approved'; token_hash?: string }>({
    action: 'poll',
    secret,
  });
  if (res.status !== 'approved' || !res.token_hash) return res.status === 'approved' ? 'expired' : res.status;
  const { error } = await supabase.auth.verifyOtp({ token_hash: res.token_hash, type: 'magiclink' });
  if (error) throw error;
  return 'signed-in';
}

/** Phone: approve the code shown on the TV, signing the TV in to this account. */
export async function approveTvSignIn(code: string): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sign in on your phone first.');
  await call<{ ok: true }>({ action: 'approve', code }, token);
}

export { cleanTvCode, formatTvCode, tvSignInLink } from './tv-code';
