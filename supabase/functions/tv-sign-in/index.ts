// tv-sign-in: sign the Google TV app in from a phone, so nobody types a password with a remote.
//
// 1. The TV calls { action: "start" } and shows the code it gets back (and a QR code of it).
//    It keeps the secret to itself.
// 2. On the phone, signed in already, the person enters or scans the code. The phone calls
//    { action: "approve", code } with its own sign-in token.
// 3. The TV polls { action: "poll", secret }. Once approved it receives a one-time token_hash and
//    calls supabase.auth.verifyOtp({ token_hash, type: "magiclink" }). That gives the TV its own
//    session for the same account; the phone stays signed in. No email is sent.
//
// Codes live 10 minutes and are deleted as soon as the TV has used them.
// Deploy with verify_jwt off (start and poll come from a TV that isn't signed in yet):
//   npx supabase functions deploy tv-sign-in --no-verify-jwt
// Needs the table from migration 20261128150000_tv_sign_in.sql.

import { createClient } from "jsr:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const TTL_SECONDS = 600;
const POLL_SECONDS = 3;
/** Refuse new codes when this many are waiting: stops anyone filling the table. */
const MAX_PENDING = 200;
// No 0/O, 1/I/L, so the code is easy to read off a TV across the room.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function randomCode(len = 6): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  // 256 % 31 leaves a tiny bias; irrelevant for a 10 minute pairing code.
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Codes are shown as "K7P 4QX"; accept any spacing, dashes and case. */
const normaliseCode = (raw: unknown) => String(raw ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");

async function start() {
  const now = new Date();
  await db.from("tv_sign_in").delete().lt("expires_at", now.toISOString());
  const { count, error: countErr } = await db.from("tv_sign_in").select("code", { count: "exact", head: true });
  if (countErr) return json(500, { error: countErr.message });
  if ((count ?? 0) >= MAX_PENDING) return json(429, { error: "Too many TV sign-ins waiting. Try again in a few minutes." });

  const secret = randomSecret();
  const expires = new Date(now.getTime() + TTL_SECONDS * 1000);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const { error } = await db
      .from("tv_sign_in")
      .insert({ code, secret_hash: await sha256(secret), expires_at: expires.toISOString() });
    if (!error) return json(200, { code, secret, expires_in: TTL_SECONDS, interval: POLL_SECONDS });
    if (error.code !== "23505") return json(500, { error: error.message });
  }
  return json(500, { error: "Could not make a code. Try again." });
}

async function approve(req: Request, rawCode: unknown) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: who, error: authErr } = await db.auth.getUser(token);
  if (authErr || !who?.user) return json(401, { error: "Sign in on your phone first." });

  const code = normaliseCode(rawCode);
  if (code.length !== 6) return json(400, { error: "The code on the TV has 6 letters and numbers." });

  const { data, error } = await db
    .from("tv_sign_in")
    .update({ user_id: who.user.id, approved_at: new Date().toISOString() })
    .eq("code", code)
    .is("user_id", null)
    .gt("expires_at", new Date().toISOString())
    .select("code");
  if (error) return json(500, { error: error.message });
  if (!data?.length) return json(404, { error: "That code isn't valid any more. Check the TV for a new one." });
  return json(200, { ok: true });
}

async function poll(secret: unknown) {
  if (typeof secret !== "string" || secret.length < 20) return json(400, { error: "Missing secret." });
  const hash = await sha256(secret);
  const { data: row, error } = await db
    .from("tv_sign_in")
    .select("code,user_id,expires_at")
    .eq("secret_hash", hash)
    .maybeSingle();
  if (error) return json(500, { error: error.message });
  if (!row || new Date(row.expires_at) < new Date()) return json(200, { status: "expired" });
  if (!row.user_id) return json(200, { status: "pending" });

  // Used once: delete before handing out the token so a second poll can't use it again.
  const { data: deleted } = await db.from("tv_sign_in").delete().eq("secret_hash", hash).select("code");
  if (!deleted?.length) return json(200, { status: "expired" });

  const { data: user, error: userErr } = await db.auth.admin.getUserById(row.user_id);
  const email = user?.user?.email;
  if (userErr || !email) return json(500, { error: "This account has no email address, so the TV can't sign in with it." });

  // generateLink makes a one-time sign-in token without sending an email.
  const { data: link, error: linkErr } = await db.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkErr || !tokenHash) return json(500, { error: linkErr?.message ?? "Could not sign the TV in." });
  return json(200, { status: "approved", token_hash: tokenHash, email });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Use POST." });
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // Empty body: treated as an unknown action below.
  }
  try {
    switch (body.action) {
      case "start":
        return await start();
      case "approve":
        return await approve(req, body.code);
      case "poll":
        return await poll(body.secret);
      default:
        return json(400, { error: "Unknown action." });
    }
  } catch (e) {
    return json(500, { error: (e as Error).message ?? "Something went wrong." });
  }
});
