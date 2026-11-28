import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { fonts, colors } from '../lib/theme';
import { approveTvSignIn, cleanTvCode, formatTvCode } from '../lib/tv-sign-in';

/** Phone side of TV sign-in: enter the code the TV shows and the TV signs in to this account. */
export function TvApprove({ initialCode = '', onDone }: { initialCode?: string; onDone?: () => void }) {
  const [code, setCode] = useState(cleanTvCode(initialCode));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const approve = async () => {
    if (code.length !== 6) {
      setMessage({ text: 'The code on the TV has 6 letters and numbers.', error: true });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await approveTvSignIn(code);
      setMessage({ text: 'Done. The TV signs in within a few seconds.' });
      setCode('');
      onDone?.();
    } catch (e) {
      setMessage({ text: (e as Error).message || "Couldn't sign the TV in.", error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.small}>
        On the TV, open What to Watch. Type the code it shows here to sign the TV in to this account.
      </Text>
      <View style={styles.row}>
        <TextInput
          value={code.length > 3 ? formatTvCode(code.padEnd(6, ' ')).trimEnd() : code}
          onChangeText={(t) => setCode(cleanTvCode(t))}
          placeholder="ABC 123"
          placeholderTextColor={colors.muted}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={7}
          returnKeyType="go"
          onSubmitEditing={approve}
          style={styles.input}
          accessibilityLabel="TV code"
        />
        <Pressable
          style={({ pressed }) => [styles.btn, (pressed || busy) && { opacity: 0.8 }]}
          onPress={approve}
          disabled={busy}
          accessibilityRole="button"
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Sign in TV</Text>}
        </Pressable>
      </View>
      {message && <Text style={[styles.small, message.error ? { color: colors.redSoftText } : { color: colors.okText }]}>{message.text}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10 },
  input: {
    flex: 1,
    backgroundColor: colors.surface2,
    color: colors.text,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontFamily: fonts.bodyBold,
    fontSize: 18,
    letterSpacing: 3,
  },
  btn: { backgroundColor: colors.red, borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center', minWidth: 110, alignItems: 'center' },
  btnText: { color: '#fff', fontFamily: fonts.bodyBold, fontSize: 14 },
  small: { color: colors.muted, fontFamily: fonts.body, fontSize: 12, lineHeight: 17 },
});
