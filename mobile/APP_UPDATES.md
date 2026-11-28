# Installing and updating the app without the Play Store

The Android app (phone and Google TV, one APK) is installed straight from this repository's
GitHub Releases and keeps itself up to date. Everything here is free: GitHub Actions (public
repository), Expo's free plan for over-the-air updates, and Obtainium.

## How updates reach the phone and TV

There are two kinds of update, and the GitHub workflow `.github/workflows/android-release.yml`
picks the right one by itself every time a change to `mobile/` lands on `main`:

| Change | What happens | What you do |
| --- | --- | --- |
| Screens, features, fixes (JavaScript only, almost every change) | An **over-the-air update** is published with EAS Update | Nothing. The app downloads it in the background and uses it the next time it opens. If it stays open, it checks again when you come back to it (at most every 30 minutes). Or tap **Check for updates** in About (phone) or Account (TV) |
| New native module, permission, app icon, Expo SDK upgrade | A **new APK** is built and published as a GitHub release (`v1.0.<n>`) | Obtainium shows an update. Tap **Update** |

The workflow tells them apart with the app's runtime version, a fingerprint of everything native.
Each release's notes carry the fingerprint of its APK. When a push has the same fingerprint as a
release, an over-the-air update is safe for the apps installed from it. When nothing matches, the
installed apps can't run the new code, so a new APK is built instead.

## One-off setup

### 1. Expo project and token (expo.dev, free account)

1. Sign in at [expo.dev](https://expo.dev). If you built the TV APK with EAS before, the
   **what-to-watch** project is already in your list. Otherwise choose **Create a project**, and
   name it `what-to-watch` (the slug must be `what-to-watch`).
2. Open the project and copy its **ID** from the overview page (a UUID like
   `1b2c3d4e-...`).
3. Go to **Account settings → Access tokens → Create token**, name it `github-actions`, and copy
   the token. It is shown only once.

### 2. GitHub secret and variable

In the repository on GitHub, go to **Settings → Secrets and variables → Actions**:

1. **Secrets** tab → **New repository secret**: name `EXPO_TOKEN`, value the token from step 1.3.
2. **Variables** tab → **New repository variable**: name `EAS_PROJECT_ID`, value the ID from
   step 1.2.

Until both exist, the workflow skips with a warning instead of failing.

### 3. Make the first release

Go to **Actions → Android app release → Run workflow** (branch `main`). The first run builds the
APK on GitHub's runner, which takes about 20 minutes, and publishes the release **What to Watch
1.0.<n>** with the APK attached. EAS creates and keeps the signing key for the project the first
time; every later APK is signed with the same key, so updates install over the top.

### 4. Install Obtainium and the app on the phone

1. On the phone, open [github.com/ImranR98/Obtainium/releases](https://github.com/ImranR98/Obtainium/releases/latest)
   and download the APK whose name ends in `arm64-v8a-release.apk`. Open it, and allow your browser
   to install unknown apps when Android asks.
2. Open Obtainium → **Add app** → App source URL
   `https://github.com/mubeenh04/what-to-watch` → **Add**, then **Install**. Allow Obtainium to
   install unknown apps when asked.
3. What to Watch is now on the home screen with its own icon. Obtainium checks for new releases in
   the background and notifies you.

### 5. Install Obtainium and the app on the Google TV

1. Install **Downloader** (by AFTVnews) from the Play Store on the TV.
2. Turn on developer options: Settings → System → About → select **Android TV OS build** 7 times.
   Then in Settings → Apps → Security & restrictions → Unknown sources, allow **Downloader**.
3. In Downloader, open `github.com/ImranR98/Obtainium/releases`, download the
   `armeabi-v7a-release.apk` (most TVs; use `arm64-v8a` if the TV says it isn't compatible), and
   install it. Allow Obtainium under Unknown sources too.
4. In Obtainium, add `https://github.com/mubeenh04/what-to-watch` as on the phone and install.
   The app appears in the TV's apps row with its banner.

If What to Watch was installed on the TV from an earlier hand-made EAS build, Obtainium installs
over it and you stay signed in. If Android says **App not installed**, that build was signed with a
different key: uninstall the old app first (Settings → Apps), then install again and sign in with
the phone code.

## Publishing an update

- **Normally:** merge a pull request that changes `mobile/` into `main`. The workflow runs on its
  own and publishes either an over-the-air update or a new APK release. Changes to `.md` files
  alone don't trigger it.
- **By hand:** Actions → Android app release → Run workflow. Tick **Build and release a new APK**
  to force a new APK even when an over-the-air update would do (for example if an update doesn't
  seem to arrive).

Watch progress under the repository's **Actions** tab. Published over-the-air updates are listed
on expo.dev under the project → **Updates**, where one can also be rolled back.

## Good to know

- The repository is public, so the APKs on Releases are public too. That's the same as before:
  the app holds only the Supabase publishable key, and every list needs a sign-in.
- Over-the-air updates only work in apps installed from a release (or another EAS build with the
  `production` channel). Expo Go doesn't use them; `npx expo start` works as before.
- Version numbers: each APK is `1.0.<workflow run number>`. About on the phone and Account on the
  TV show the version and, after an over-the-air update, the date of that update.
- Free limits: GitHub Actions minutes are free for public repositories; builds run on GitHub's
  runner with `eas build --local`, so they don't use Expo's monthly cloud build allowance. Expo's
  free plan covers over-the-air updates for up to 1,000 users a month.

## Files

| Path | What it does |
| --- | --- |
| `.github/workflows/android-release.yml` | Decides update or APK, publishes it |
| `app.json` | `runtimeVersion` (fingerprint policy) and `updates` settings, `expo-updates` plugin |
| `app.config.js` | Update URL from `EAS_PROJECT_ID`; version and versionCode from the workflow |
| `eas.json` | `production` profile (APK, channel `production`); `preview` uses the same channel |
| `src/lib/updates.ts` | Foreground update checks, **Check for updates**, version label |
