-- TV sign-in with a phone (Google TV app).
--
-- The TV shows a short code. On the phone (already signed in) the person enters or scans that
-- code, and the TV is signed in to the same account. Only the Edge Function tv-sign-in reads or
-- writes this table, with the service role: row-level security is on and there are no policies,
-- so the app's publishable key can't see it.
--
-- Run once in the Supabase SQL editor. Safe to run again.

CREATE TABLE IF NOT EXISTS public.tv_sign_in (
    code         TEXT         PRIMARY KEY,                 -- what the TV shows, e.g. K7P4QX
    secret_hash  TEXT         NOT NULL UNIQUE,             -- sha256 of the secret only the TV knows
    user_id      UUID         NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    approved_at  TIMESTAMPTZ  NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ  NOT NULL
);

CREATE INDEX IF NOT EXISTS tv_sign_in_expires_idx ON public.tv_sign_in (expires_at);

ALTER TABLE public.tv_sign_in ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tv_sign_in FROM anon, authenticated;

COMMENT ON TABLE public.tv_sign_in IS
  'Pending TV sign-ins (Google TV app). Used only by the tv-sign-in Edge Function. Rows live 10 minutes.';
