-- Daily TMDB sync for Netflix South Africa, run by pg_cron through pg_net.
-- The shared secret lives in Vault; nothing secret is stored in this file.
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'tmdb_sync_secret') THEN
        PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'tmdb_sync_secret',
                                    'Shared secret for the tmdb-sync Edge Function');
    END IF;
END $$;

CREATE OR REPLACE FUNCTION check_sync_secret(p_secret TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (SELECT 1 FROM vault.decrypted_secrets
                    WHERE name = 'tmdb_sync_secret' AND decrypted_secret = p_secret);
$$;
REVOKE ALL ON FUNCTION check_sync_secret(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION check_sync_secret(TEXT) TO service_role;

-- Calls the Edge Function with a JSON body. Returns the pg_net request id.
CREATE OR REPLACE FUNCTION run_tmdb_sync(p_body JSONB DEFAULT '{"mode":"discover","pages":3}')
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT net.http_post(
        url     := 'https://ezedrdpzhgtwrfjmupvf.supabase.co/functions/v1/tmdb-sync',
        body    := p_body,
        headers := jsonb_build_object(
                     'content-type', 'application/json',
                     'x-sync-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets
                                        WHERE name = 'tmdb_sync_secret')),
        timeout_milliseconds := 150000);
$$;
REVOKE ALL ON FUNCTION run_tmdb_sync(JSONB) FROM PUBLIC, anon, authenticated;

-- 03:00 SAST: newest Netflix ZA and trending titles. 03:30 SAST: re-check older titles.
SELECT cron.schedule('tmdb-sync-discover', '0 1 * * *', $$SELECT public.run_tmdb_sync('{"mode":"discover","pages":3}')$$);
SELECT cron.schedule('tmdb-sync-refresh',  '30 1 * * *', $$SELECT public.run_tmdb_sync('{"mode":"refresh","limit":150}')$$);
