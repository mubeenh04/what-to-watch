import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { useEffect } from 'react';
import { AppState } from 'react-native';

/**
 * Over-the-air updates (EAS Update). On every launch expo-updates checks for a new update and
 * downloads it in the background (app.json: checkAutomatically ON_LOAD), and the next launch uses
 * it. TVs and phones often keep the app in memory for days, so this also checks when the app comes
 * back to the foreground, at most every 30 minutes, and restarts into a new update straight away.
 *
 * Only builds made with EAS have updates switched on; in Expo Go and dev builds this does nothing.
 */
const FOREGROUND_CHECK_MS = 30 * 60 * 1000;

export const updatesEnabled = !__DEV__ && Updates.isEnabled;

export function useOtaUpdates() {
  useEffect(() => {
    if (!updatesEnabled) return;
    let lastCheck = Date.now(); // the launch check has just run
    let busy = false;
    const sub = AppState.addEventListener('change', async (state) => {
      if (state !== 'active' || busy || Date.now() - lastCheck < FOREGROUND_CHECK_MS) return;
      busy = true;
      lastCheck = Date.now();
      try {
        if (await downloadUpdate()) await Updates.reloadAsync();
      } catch {
        // Offline or the update server is unreachable: try again next time.
      } finally {
        busy = false;
      }
    });
    return () => sub.remove();
  }, []);
}

/** Downloads a newer update if there is one. True when one is ready to restart into. */
async function downloadUpdate(): Promise<boolean> {
  const check = await Updates.checkForUpdateAsync();
  if (!check.isAvailable) return false;
  await Updates.fetchUpdateAsync();
  return true;
}

export type UpdateCheckResult = 'restarting' | 'up-to-date' | 'unavailable';

/** For the "Check for updates" button: downloads and restarts into a new update right away. */
export async function checkForUpdateNow(): Promise<UpdateCheckResult> {
  if (!updatesEnabled) return 'unavailable';
  if (!(await downloadUpdate())) return 'up-to-date';
  await Updates.reloadAsync();
  return 'restarting';
}

/** "Version 1.0.4", plus the date of the over-the-air update that is running, if any. */
export function versionLabel(): string {
  const version = Constants.expoConfig?.version ?? '1.0.0';
  if (!updatesEnabled || Updates.isEmbeddedLaunch || !Updates.createdAt) return `Version ${version}`;
  const date = Updates.createdAt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return `Version ${version}, updated ${date}`;
}
