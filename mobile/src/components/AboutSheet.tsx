import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { listRatedMovies } from '../lib/api';
import { buildLetterboxdCsv } from '../lib/letterboxd';
import { supabase } from '../lib/supabase';

import { colors, fonts } from '../lib/theme';
import { useSession } from '../state/session';
import { BottomSheet } from './BottomSheet';

/** Account and About: signed-in email, sign out, and the data attributions TMDB requires. */
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
