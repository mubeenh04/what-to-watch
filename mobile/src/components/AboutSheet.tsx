import type { UserIdentity } from '@supabase/supabase-js';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { listRatedMovies } from '../lib/api';
import { linkGoogle, listIdentities, unlinkGoogle } from '../lib/google-auth';
import { buildLetterboxdCsv } from '../lib/letterboxd';
import { supabase } from '../lib/supabase';
import { colors, fonts } from '../lib/theme';
import { checkForUpdateNow, updatesEnabled, versionLabel } from '../lib/updates';
import { useSession } from '../state/session';
import { BottomSheet } from './BottomSheet';
import { GoogleIcon } from './Icons';
import { TvApprove } from './TvApprove';

/** Account and About: signed-in email, sign-in methods (link Google), sign out, and TMDB's attributions. */
export function AboutSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { session, signOut } = useSession();
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);

  /** Writes the ratings CSV and opens the share sheet so it can be saved or sent to a computer. */
  const exportRatings = async () => {
    setExporting(true);
    setExportNote(null);
    try {
      const { csv, count } = buildLetterboxdCsv(await listRatedMovies(supabase));
      if (!count) {
        setExportNote('No rated films yet. Rate films in History first.');
        return;
      }
      const file = new File(Paths.cache, 'what-to-watch-letterboxd-ratings.csv');
      if (file.exists) file.delete();
      file.create();
      file.write(csv);
      if (!(await Sharing.isAvailableAsync())) {
        setExportNote('Sharing is not available on this device.');
        return;
      }
      await Sharing.shareAsync(file.uri, {
        mimeType: 'text/csv',
        UTI: 'public.comma-separated-values-text',
        dialogTitle: 'Letterboxd ratings',
      });
      setExportNote(`Exported ${count} rated film${count === 1 ? '' : 's'}.`);
    } catch (e) {
      setExportNote(`Couldn't export: ${(e as Error)?.message || 'try again'}`);
    } finally {
      setExporting(false);
    }
  };
  return (
    <BottomSheet visible={visible} onClose={onClose} header={<Text style={styles.h2}>ABOUT</Text>}>
      <View style={styles.body}>
        <Text style={styles.label}>SIGNED IN AS</Text>
        <Text style={styles.text}>{session?.user.email ?? '—'}</Text>

        <Text style={styles.label}>SIGN-IN METHODS</Text>
        {visible && <SignInMethods />}

        <Text style={styles.label}>SIGN IN A TV</Text>
        <TvApprove />

        <Text style={styles.label}>LETTERBOXD</Text>
        <Text style={styles.small}>
          Export the ratings you gave in History as a file, then upload it on letterboxd.com under Settings, then Import.
          Letterboxd doesn't allow apps to send ratings directly.
        </Text>
        <Pressable
          style={({ pressed }) => [styles.exportBtn, pressed && { opacity: 0.8 }]}
          disabled={exporting}
          onPress={exportRatings}
          accessibilityRole="button"
        >
          {exporting ? <ActivityIndicator color={colors.letterboxdText} /> : <Text style={styles.exportText}>Export ratings for Letterboxd</Text>}
        </Pressable>
        {exportNote && <Text style={styles.small}>{exportNote}</Text>}
        <Pressable onPress={() => Linking.openURL('https://letterboxd.com/import/')}>
          <Text style={styles.link}>letterboxd.com/import</Text>
        </Pressable>

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

        <AppVersion />

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

/** The app's version, and a button that fetches an over-the-air update now instead of at the next launch. */
function AppVersion() {
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const check = async () => {
    setChecking(true);
    setNote(null);
    try {
      const result = await checkForUpdateNow();
      if (result === 'up-to-date') setNote('You have the latest version.');
    } catch {
      setNote("Couldn't check for updates. Try again when you're online.");
    } finally {
      setChecking(false);
    }
  };
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.small}>{versionLabel()}</Text>
      {updatesEnabled && (
        <Pressable onPress={check} disabled={checking} accessibilityRole="button">
          <Text style={styles.link}>{checking ? 'Checking for updates…' : 'Check for updates'}</Text>
        </Pressable>
      )}
      {note && <Text style={styles.small}>{note}</Text>}
    </View>
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
  exportBtn: {
    borderWidth: 1,
    borderColor: colors.letterboxdBorder,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    backgroundColor: colors.surface2,
  },
  exportText: { color: colors.letterboxdText, fontFamily: fonts.bodyBold, fontSize: 14 },
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
