import type { UserIdentity } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { linkGoogle, listIdentities, unlinkGoogle } from '../lib/google-auth';
import { colors, fonts } from '../lib/theme';
import { useSession } from '../state/session';
import { BottomSheet } from './BottomSheet';
import { GoogleIcon } from './Icons';

/** Account and About: signed-in email, sign-in methods (link Google), sign out, and TMDB's attributions. */
export function AboutSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { session, signOut } = useSession();
  return (
    <BottomSheet visible={visible} onClose={onClose} header={<Text style={styles.h2}>ABOUT</Text>}>
      <View style={styles.body}>
        <Text style={styles.label}>SIGNED IN AS</Text>
        <Text style={styles.text}>{session?.user.email ?? '—'}</Text>

        <Text style={styles.label}>SIGN-IN METHODS</Text>
        {visible && <SignInMethods />}

        <Text style={styles.label}>DATA</Text>
        <View style={styles.tmdbRow}>
          <View style={styles.tmdbMark}>
            <Text style={styles.tmdbText}>TMDB</Text>
          </View>
          <Text style={[styles.text, { flex: 1 }]}>
            This product uses the TMDB API but is not endorsed or certified by TMDB.
          </Text>
        </View>
        <Text style={styles.small}>
          Titles, posters, cast and genres come from The Movie Database. Where-to-watch data for South Africa is
          provided to TMDB by JustWatch.
        </Text>
        <View style={styles.links}>
          <Pressable onPress={() => Linking.openURL('https://www.themoviedb.org/')}>
            <Text style={styles.link}>themoviedb.org</Text>
          </Pressable>
          <Pressable onPress={() => Linking.openURL('https://www.justwatch.com/')}>
            <Text style={styles.link}>justwatch.com</Text>
          </Pressable>
        </View>

        <Text style={styles.small}>Version {Constants.expoConfig?.version ?? '1.0.0'}</Text>

        <Pressable
          style={({ pressed }) => [styles.signOut, pressed && { opacity: 0.8 }]}
          onPress={async () => {
            onClose();
            await signOut();
          }}
        >
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

/**
 * Lists how this account can sign in and lets an existing email-and-password member add Google.
 * Linking keeps the same account (same user id), so every list stays as it is.
 */
function SignInMethods() {
  const [identities, setIdentities] = useState<UserIdentity[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      setIdentities(await listIdentities());
    } catch (e) {
      setIdentities([]);
      setMessage({ text: (e as Error).message || 'Could not load sign-in methods.', error: true });
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  if (!identities) return <ActivityIndicator color={colors.red} style={{ alignSelf: 'flex-start' }} />;

  const email = identities.find((i) => i.provider === 'email');
  const google = identities.find((i) => i.provider === 'google');
  const googleEmail = (google?.identity_data?.email as string | undefined) ?? null;

  const link = async () => {
    setBusy(true);
    setMessage(null);
    const res = await linkGoogle();
    if (res.ok) setMessage({ text: 'Google is linked. You can now sign in with Google or your password, and your lists stay the same.' });
    else if (!res.cancelled) setMessage({ text: res.message, error: true });
    await load();
    setBusy(false);
  };
  const unlink = async () => {
    if (!google) return;
    setBusy(true);
    setMessage(null);
    const res = await unlinkGoogle(google);
    if (res.ok) setMessage({ text: 'Google is no longer linked. Sign in with your email and password from now on.' });
    else setMessage({ text: res.message, error: true });
    await load();
    setBusy(false);
  };

  return (
    <View style={{ gap: 8 }}>
      {email && <Text style={styles.text}>Email and password</Text>}
      {google ? (
        <View style={styles.methodRow}>
          <GoogleIcon size={16} />
          <Text style={[styles.text, { flex: 1 }]}>Google{googleEmail ? ` · ${googleEmail}` : ''}</Text>
          {identities.length > 1 && (
            <Pressable onPress={unlink} disabled={busy} hitSlop={8}>
              <Text style={styles.link}>Unlink</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <Pressable
          style={({ pressed }) => [styles.googleBtn, (pressed || busy) && { opacity: 0.8 }]}
          onPress={link}
          disabled={busy}
          accessibilityRole="button"
        >
          {busy ? (
            <ActivityIndicator color="#1f1f1f" />
          ) : (
            <>
              <GoogleIcon size={18} />
              <Text style={styles.googleText}>Link Google account</Text>
            </>
          )}
        </Pressable>
      )}
      {!google && !message && (
        <Text style={styles.small}>Sign in with Google next time instead of your password. Your lists stay the same.</Text>
      )}
      {message && <Text style={[styles.small, message.error && { color: colors.redSoftText }]}>{message.text}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  methodRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  googleBtn: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#747775',
    borderRadius: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    minHeight: 46,
  },
  googleText: { color: '#1f1f1f', fontFamily: fonts.bodySemi, fontSize: 15 },
  body: { paddingHorizontal: 20, gap: 8 },
  h2: {
    color: colors.text,
    fontFamily: fonts.display,
    fontSize: 26,
    letterSpacing: 0.8,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 6,
  },
  label: { color: colors.muted, fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.3, marginTop: 10 },
  text: { color: colors.text, fontFamily: fonts.body, fontSize: 14, lineHeight: 20 },
  small: { color: colors.muted, fontFamily: fonts.body, fontSize: 12, lineHeight: 17 },
  tmdbRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  // TMDB's brand colours (dark blue with their green-to-blue accent).
  tmdbMark: {
    backgroundColor: '#0d253f',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderBottomWidth: 3,
    borderBottomColor: '#01b4e4',
  },
  tmdbText: { color: '#90cea1', fontFamily: fonts.display, fontSize: 15, letterSpacing: 1 },
  links: { flexDirection: 'row', gap: 18, marginVertical: 4 },
  link: { color: colors.red, fontFamily: fonts.bodySemi, fontSize: 13 },
  signOut: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  signOutText: { color: colors.text, fontFamily: fonts.bodyBold, fontSize: 15 },
});
