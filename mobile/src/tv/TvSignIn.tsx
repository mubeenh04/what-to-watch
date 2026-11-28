import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View, type TextInputInstance } from 'react-native';

import { QrCode } from '../components/QrCode';
import { supabase } from '../lib/supabase';
import { fonts } from '../lib/theme';
import { SAFE_X, SAFE_Y, px } from '../lib/tv';
import { formatTvCode, pollTvSignIn, startTvSignIn, tvSignInLink, TvSignInUnavailable, type TvCode } from '../lib/tv-sign-in';
import { tvColors as c } from './focus';
import { T, TvButton } from './ui';

/**
 * TV sign-in. Typing with a remote is slow, so the main way is the phone: the TV shows a code,
 * the phone (already signed in) approves it, and the TV signs in to the same account.
 * Email and password work too.
 */
export function TvSignIn() {
  const [code, setCode] = useState<TvCode | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [approved, setApproved] = useState(false);
  const attempt = useRef(0);

  const newCode = useCallback(async () => {
    const id = ++attempt.current;
    setCodeError(null);
    try {
      const c = await startTvSignIn();
      if (id === attempt.current) setCode(c);
    } catch (e) {
      if (id !== attempt.current) return;
      if (e instanceof TvSignInUnavailable) setUnavailable(true);
      else setCodeError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    newCode();
  }, [newCode]);

  // Ask every few seconds whether the phone approved; get a new code when this one runs out.
  useEffect(() => {
    if (!code) return;
    let stopped = false;
    const expiresAt = Date.now() + code.expires_in * 1000;
    const tick = async () => {
      if (stopped) return;
      if (Date.now() > expiresAt) return newCode();
      try {
        const res = await pollTvSignIn(code.secret);
        if (stopped) return;
        if (res === 'signed-in') return setApproved(true);
        if (res === 'expired') return newCode();
      } catch (e) {
        if (!stopped) setCodeError((e as Error).message);
      }
      timer = setTimeout(tick, Math.max(2, code.interval) * 1000);
    };
    let timer = setTimeout(tick, code.interval * 1000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [code, newCode]);

  return (
    <View style={styles.screen}>
      <Text style={styles.logo}>
        WHAT <Text style={{ color: c.red }}>TO</Text> WATCH
      </Text>
      <Text style={[T.small, { position: 'absolute', left: SAFE_X, top: SAFE_Y + px(70) }]}>
        Everything on Netflix and your drives in one place, plus picks to put on your radar.
      </Text>

      <View style={styles.cols}>
        <View style={[styles.card, { flex: 1.25 }]}>
          <Text style={T.label}>Sign in with your phone</Text>
          {unavailable ? (
            <Text style={T.body}>
              Phone sign-in isn't switched on yet (the tv-sign-in function needs deploying). Use email and password on the
              right for now.
            </Text>
          ) : approved ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: px(20) }}>
              <ActivityIndicator color={c.red} size="large" />
              <Text style={T.body}>Approved. Signing in…</Text>
            </View>
          ) : code ? (
            <View style={{ flexDirection: 'row', gap: px(44), alignItems: 'center' }}>
              <View style={styles.qr}>
                <QrCode value={tvSignInLink(code.code)} size={px(260)} accessibilityLabel="QR code to sign in from your phone" />
              </View>
              <View style={{ flex: 1, gap: px(18) }}>
                <Text style={styles.code}>{formatTvCode(code.code)}</Text>
                <Step n={1} text="Open What to Watch on your phone (signed in)." />
                <Step n={2} text="Tap the person icon, then Sign in a TV." />
                <Step n={3} text="Enter this code. This TV signs in by itself." />
                <Text style={[T.small, { fontSize: px(18) }]}>
                  With the installed app you can also scan the QR code with the phone's camera. The code changes every 10 minutes.
                </Text>
              </View>
            </View>
          ) : codeError ? (
            <View style={{ gap: px(20) }}>
              <Text style={T.body}>{codeError}</Text>
              <TvButton label="Try again" primary onPress={newCode} style={{ alignSelf: 'flex-start' }} />
            </View>
          ) : (
            <ActivityIndicator color={c.red} size="large" style={{ alignSelf: 'flex-start' }} />
          )}
          {code && codeError && !approved && <Text style={[T.small, { color: c.redSoftText }]}>{codeError}</Text>}
        </View>

        <EmailSignIn />
      </View>
    </View>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: px(16), alignItems: 'center' }}>
      <View style={styles.stepDot}>
        <Text style={styles.stepNum}>{n}</Text>
      </View>
      <Text style={[T.body, { flex: 1, fontSize: px(24), lineHeight: px(32) }]}>{text}</Text>
    </View>
  );
}

function EmailSignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const passwordRef = useRef<TextInputInstance>(null);

  const submit = async () => {
    if (!email.trim() || password.length < 6) {
      setMessage('Enter your email and password.');
      return;
    }
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setMessage(error.message);
  };

  return (
    <View style={[styles.card, { flex: 1 }]}>
      <Text style={T.label}>Or use email and password</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="Email"
        placeholderTextColor={c.dim}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        style={styles.input}
      />
      <TextInput
        ref={passwordRef}
        value={password}
        onChangeText={setPassword}
        placeholder="Password"
        placeholderTextColor={c.dim}
        secureTextEntry
        returnKeyType="go"
        onSubmitEditing={submit}
        style={styles.input}
      />
      <TvButton label="Sign in" onPress={submit} busy={busy} style={{ alignSelf: 'flex-start' }} />
      {message && <Text style={[T.small, { color: c.redSoftText }]}>{message}</Text>}
      <Text style={[T.small, { fontSize: px(18) }]}>
        Signed up with Google? Use the phone code instead: Google sign-in needs a web browser, which most TVs don't have.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.app },
  logo: { position: 'absolute', left: SAFE_X, top: SAFE_Y, color: c.text, fontFamily: fonts.display, fontSize: px(56) },
  cols: {
    position: 'absolute',
    left: SAFE_X,
    right: SAFE_X,
    top: px(250),
    bottom: SAFE_Y + px(20),
    flexDirection: 'row',
    gap: px(40),
  },
  card: { backgroundColor: c.surface, borderRadius: px(24), padding: px(48), gap: px(28) },
  qr: { backgroundColor: '#fff', borderRadius: px(16), padding: px(18) },
  code: { color: c.text, fontFamily: fonts.display, fontSize: px(110), letterSpacing: px(10), lineHeight: px(110) },
  stepDot: { width: px(44), height: px(44), borderRadius: px(22), backgroundColor: c.redDeep, alignItems: 'center', justifyContent: 'center' },
  stepNum: { color: '#fff', fontFamily: fonts.bodyBold, fontSize: px(22) },
  input: {
    backgroundColor: c.surface2,
    color: c.text,
    fontFamily: fonts.bodySemi,
    fontSize: px(28),
    borderRadius: px(14),
    paddingHorizontal: px(24),
    paddingVertical: px(18),
  },
});
