import { ArchivoNarrow_600SemiBold, ArchivoNarrow_700Bold } from '@expo-google-fonts/archivo-narrow';
import {
  Figtree_400Regular,
  Figtree_500Medium,
  Figtree_600SemiBold,
  Figtree_700Bold,
  Figtree_800ExtraBold,
} from '@expo-google-fonts/figtree';
import { useFonts } from 'expo-font';
import { Slot } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Centered, SignIn } from '../components/SignIn';
import { isConfigured } from '../lib/config';
import { colors } from '../lib/theme';
import { isTV, px } from '../lib/tv';
import { AppDataProvider } from '../state/app-data';
import { SessionProvider, useSession } from '../state/session';
import { ToastProvider } from '../state/toast';
import { TvApp } from '../tv/TvApp';
import { TvSignIn } from '../tv/TvSignIn';

SplashScreen.preventAutoHideAsync().catch(() => {});

// One app for phone and TV: the app allows any orientation so a TV runs landscape, and phones
// lock themselves to portrait here.
if (!isTV) ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    ArchivoNarrow_600SemiBold,
    ArchivoNarrow_700Bold,
    Figtree_400Regular,
    Figtree_500Medium,
    Figtree_600SemiBold,
    Figtree_700Bold,
    Figtree_800ExtraBold,
  });
  const ready = fontsLoaded || !!fontError;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;
  return (
    <View style={{ flex: 1, backgroundColor: colors.app }}>
      <StatusBar style="light" />
      {isConfigured ? (
        <SessionProvider>
          <Gate />
        </SessionProvider>
      ) : (
        <Centered
          title="SUPABASE NOT SET UP"
          text="Copy mobile/.env.example to mobile/.env, then restart with npx expo start --clear."
        />
      )}
    </View>
  );
}

function Gate() {
  const { loading, session, profile, profileError, retryProfile } = useSession();
  const insets = useSafeAreaInsets();
  if (loading) return <Centered title="WHAT TO WATCH" />;
  if (!session) return isTV ? <TvSignIn /> : <SignIn />;
  if (profileError)
    return (
      <Centered
        title="COULDN'T SET UP YOUR LISTS"
        text={profileError}
        action={{ label: 'Try again', onPress: retryProfile }}
      />
    );
  if (!profile) return <Centered title="SORTING YOUR TITLES" text="Putting what's on Netflix in Home and the rest in Explore. This only happens once." />;
  if (isTV)
    return (
      <AppDataProvider userId={profile.user_id} key={profile.user_id}>
        <ToastProvider bottom={px(54)} inset={px(560)}>
          <TvApp />
        </ToastProvider>
      </AppDataProvider>
    );
  return (
    <AppDataProvider userId={profile.user_id} key={profile.user_id}>
      <ToastProvider bottom={insets.bottom + 72}>
        <Slot />
      </ToastProvider>
    </AppDataProvider>
  );
}
