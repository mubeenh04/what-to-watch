import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { supabase } from '../lib/supabase';
import { colors, fonts } from '../lib/theme';

/** Email and password sign-in with Supabase Auth. */
export function SignIn() {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const submit = async () => {
    const e = email.trim();
    if (!e || password.length < 6) {
      setMessage({ text: 'Enter your email and a password of at least 6 characters.', error: true });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email: e, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({ email: e, password });
        if (error) throw error;
        if (!data.session) {
          setMode('signin');
          setMessage({ text: 'Check your email and tap the confirmation link, then sign in here.' });
        }
      }
    } catch (err) {
      setMessage({ text: (err as Error).message || 'Something went wrong.', error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.screen, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 20 }]}
    >
      <View style={styles.inner}>
        <Text style={styles.brand}>
          WHAT TO <Text style={{ color: colors.red }}>WATCH</Text>
        </Text>
        <Text style={styles.sub}>
          Everything on Netflix and your drives in one place, plus picks to put on your radar.
        </Text>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            value={email}
            onChangeText={setEmail}
            editable={!busy}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={colors.muted}
            secureTextEntry
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            textContentType={mode === 'signin' ? 'password' : 'newPassword'}
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={submit}
            editable={!busy}
          />
          {message && <Text style={[styles.msg, message.error && { color: colors.redSoftText }]}>{message.text}</Text>}
          <Pressable style={({ pressed }) => [styles.primary, (pressed || busy) && { opacity: 0.8 }]} onPress={submit} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{mode === 'signin' ? 'Sign in' : 'Create account'}</Text>}
          </Pressable>
          <Pressable
            onPress={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin');
              setMessage(null);
            }}
            hitSlop={8}
          >
            <Text style={styles.switch}>
              {mode === 'signin' ? 'New here? Create an account' : 'Already have an account? Sign in'}
            </Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

export function Centered({ title, text, action }: { title: string; text?: string; action?: { label: string; onPress: () => void } }) {
  return (
    <View style={[styles.screen, { justifyContent: 'center', alignItems: 'center', padding: 24 }]}>
      <Text style={[styles.brand, { fontSize: 24, textAlign: 'center' }]}>{title}</Text>
      {text && <Text style={[styles.sub, { textAlign: 'center' }]}>{text}</Text>}
      {!action && !text && <ActivityIndicator style={{ marginTop: 16 }} color={colors.red} />}
      {action && (
        <Pressable style={[styles.primary, { paddingHorizontal: 24, marginTop: 18 }]} onPress={action.onPress}>
          <Text style={styles.primaryText}>{action.label}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.app },
  inner: { flex: 1, paddingHorizontal: 24 },
  brand: { color: colors.text, fontFamily: fonts.display, fontSize: 44, letterSpacing: 0.8 },
  sub: { color: colors.muted, fontFamily: fonts.body, fontSize: 15, lineHeight: 22, marginTop: 8 },
  form: { marginTop: 36, gap: 12 },
  input: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 16,
  },
  msg: { color: colors.muted, fontFamily: fonts.body, fontSize: 13, lineHeight: 19 },
  primary: { backgroundColor: colors.red, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  primaryText: { color: '#fff', fontFamily: fonts.bodyBold, fontSize: 15 },
  switch: { color: colors.muted, fontFamily: fonts.bodySemi, fontSize: 13, textAlign: 'center', marginTop: 8 },
});
