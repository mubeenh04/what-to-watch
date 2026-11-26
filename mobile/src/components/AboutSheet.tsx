import Constants from 'expo-constants';
import { Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fonts } from '../lib/theme';
import { useSession } from '../state/session';

/** Account and About: signed-in email, sign out, and the data attributions TMDB requires. */
export function AboutSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { session, signOut } = useSession();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.grab} />
        <Text style={styles.h2}>ABOUT</Text>

        <Text style={styles.label}>SIGNED IN AS</Text>
        <Text style={styles.text}>{session?.user.email ?? '—'}</Text>

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
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.sheet,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 20,
    gap: 8,
  },
  grab: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line, alignSelf: 'center', marginTop: 10, marginBottom: 6 },
  h2: { color: colors.text, fontFamily: fonts.display, fontSize: 26, letterSpacing: 0.8, marginBottom: 4 },
  label: { color: colors.muted, fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.3, marginTop: 10 },
  text: { color: colors.text, fontFamily: fonts.body, fontSize: 14, lineHeight: 20 },
  small: { color: colors.muted, fontFamily: fonts.body, fontSize: 12, lineHeight: 17 },
  tmdbRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  // TMDB's brand colours (dark blue with their green-to-blue accent).
  tmdbMark: { backgroundColor: '#0d253f', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5, borderBottomWidth: 3, borderBottomColor: '#01b4e4' },
  tmdbText: { color: '#90cea1', fontFamily: fonts.display, fontSize: 15, letterSpacing: 1 },
  links: { flexDirection: 'row', gap: 18, marginVertical: 4 },
  link: { color: colors.red, fontFamily: fonts.bodySemi, fontSize: 13 },
  signOut: { marginTop: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface2, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  signOutText: { color: colors.text, fontFamily: fonts.bodyBold, fontSize: 15 },
});
