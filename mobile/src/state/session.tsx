import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { ensureProfile, type Profile } from '../lib/api';
import { supabase } from '../lib/supabase';

type SessionState = {
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  profileError: string | null;
  retryProfile: () => void;
  signOut: () => Promise<void>;
};

const Ctx = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  useEffect(() => {
    if (!session) {
      setProfile(null);
      setProfileError(null);
      return;
    }
    let cancelled = false;
    setProfileError(null);
    ensureProfile(supabase, session.user)
      .then((p) => !cancelled && setProfile(p))
      .catch((e) => !cancelled && setProfileError(e?.message ?? 'Could not set up your profile.'));
    return () => {
      cancelled = true;
    };
    // Only re-run when the user changes (not on every token refresh) or on retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, attempt]);

  const retryProfile = useCallback(() => setAttempt((n) => n + 1), []);
  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  return (
    <Ctx.Provider value={{ loading, session, profile, profileError, retryProfile, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession must be used inside SessionProvider');
  return v;
}
