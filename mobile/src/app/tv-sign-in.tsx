import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TvApprove } from '../components/TvApprove';
import { colors, fonts } from '../lib/theme';

/** Opened by scanning the TV's sign-in QR code with the phone camera (installed app only). */
export default function TvSignInScreen() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { paddingTop: insets.top + 40 }]}>
      <Text style={styles.title}>SIGN IN A TV</Text>
      <TvApprove initialCode={typeof code === 'string' ? code : ''} />
      <Pressable onPress={() => router.replace('/')} style={styles.back} accessibilityRole="button">
        <Text style={styles.backText}>Back to the app</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.app, paddingHorizontal: 20, gap: 16 },
  title: { color: colors.text, fontFamily: fonts.display, fontSize: 28, letterSpacing: 0.8 },
  back: { marginTop: 10, alignSelf: 'flex-start' },
  backText: { color: colors.muted, fontFamily: fonts.bodySemi, fontSize: 14, textDecorationLine: 'underline' },
});
