import Constants from 'expo-constants';
import { StyleSheet, Text, View } from 'react-native';

import { fonts } from '../lib/theme';
import { SAFE_Y, px } from '../lib/tv';
import { useSession } from '../state/session';
import { tvColors as c } from './focus';
import { T, TvButton } from './ui';

/** Who is signed in, sign out, and TMDB's attribution. */
export function AccountPanel({ onClose }: { onClose: () => void }) {
  const { session, profile, signOut } = useSession();
  return (
    <View style={StyleSheet.absoluteFill}>
      <View style={styles.dim} />
      <View style={styles.panel}>
        <Text style={[T.h1, { fontSize: px(56), lineHeight: px(56) }]}>Account</Text>
        <View style={{ gap: px(8) }}>
          <Text style={T.label}>Signed in as</Text>
          <Text style={styles.text}>{profile?.display_name ?? '—'}</Text>
          <Text style={T.small}>{session?.user.email ?? ''}</Text>
        </View>
        <Text style={T.small}>
          Your phone and this TV share the same lists. A move on one shows on the other the next time it loads.
        </Text>
        <View style={{ gap: px(10) }}>
          <Text style={T.label}>Data</Text>
          <View style={{ flexDirection: 'row', gap: px(14), alignItems: 'center' }}>
            <Text style={styles.tmdb}>TMDB</Text>
            <Text style={[T.small, { flex: 1 }]}>This product uses the TMDB API but is not endorsed or certified by TMDB.</Text>
          </View>
          <Text style={T.small}>
            Titles, posters and cast from The Movie Database. Where to watch in South Africa from JustWatch, through TMDB.
            Scores from OMDb.
          </Text>
        </View>
        <Text style={[T.small, { fontSize: px(18) }]}>Version {Constants.expoConfig?.version ?? '1.0.0'}</Text>
        <View style={{ flexDirection: 'row', gap: px(16), marginTop: 'auto' }}>
          <TvButton label="Close" primary preferred onPress={onClose} />
          <TvButton
            label="Sign out"
            onPress={async () => {
              onClose();
              await signOut();
            }}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(10,10,12,0.55)' },
  panel: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: px(720),
    backgroundColor: c.panel,
    paddingTop: SAFE_Y,
    paddingBottom: SAFE_Y,
    paddingRight: px(96),
    paddingLeft: px(64),
    gap: px(30),
  },
  text: { color: c.text, fontFamily: fonts.bodySemi, fontSize: px(30) },
  tmdb: {
    backgroundColor: '#0d253f',
    color: '#90cea1',
    fontFamily: fonts.bodyHeavy,
    fontSize: px(18),
    paddingHorizontal: px(10),
    paddingVertical: px(4),
    borderRadius: px(6),
    overflow: 'hidden',
  },
});
