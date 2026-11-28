# What to Watch on Google TV

The TV app is the same app as the phone app. On a Google TV or Android TV it switches to the TV
layout by itself (`Platform.isTV`), and on a phone it looks exactly as before. Both use the same
account and the same lists, so a title you mark Watched on the phone is in History on the TV.

## What's on the TV

Six sections as tabs along the top, moved through with the remote's D-pad. OK presses the button in
focus and Back closes whatever is open, then returns to Home, then leaves the app.

| Tab | What you see | Buttons |
| --- | --- | --- |
| Home | The focused title large at the top, then rows of movies and series | OK opens details: Open in Netflix, Watched, Hide. Search and Filters in the top right |
| Explore | The focused pick with why it's suggested, rows of movie and series picks | Add to Watchlist, Watched, Not for me. OK on a poster jumps up to the buttons |
| Watchlist | Movies / Series, one row per title | Mark downloaded, Watched |
| History | Poster grid, chosen title on the right with a QR code | Scan the QR code with your phone to rate it on Letterboxd. Move back to Home |
| Hidden | Same grid | Unhide |
| Removed | Same grid | Restore to Explore |

The person icon shows who is signed in, sign out, and the TMDB credit.

"Open in Netflix" opens Netflix's search for the title, because TMDB doesn't give us Netflix's own
title ids. If Netflix can't be opened, a message says what to search for.

## Signing in on the TV

Typing with a remote is slow, and Google sign-in needs a web browser that most TVs don't have. So
the TV shows a 6-character code (and a QR code):

1. On the phone, signed in, tap the person icon, then **Sign in a TV**, and type the code.
2. The TV signs in to the same account within a few seconds. The phone stays signed in.

With the installed phone app you can also scan the TV's QR code with the camera. Email and password
work on the TV as well.

This needs two one-off steps in Supabase:

1. **Table**: run `supabase/migrations/20261128153000_tv_sign_in.sql` in the SQL editor
   (also in the project files as `sql/20261128153000_tv_sign_in.sql`).
2. **Function**: `tv-sign-in` is deployed (2026-11-28). To redeploy after changes, with JWT verification off:
   `npx supabase functions deploy tv-sign-in --no-verify-jwt --project-ref ezedrdpzhgtwrfjmupvf`

Until the table exists, the TV says phone sign-in isn't switched on and offers email and password.

How it works: the TV asks the function for a code and keeps a secret to itself. The phone approves
the code with its own sign-in. The TV then collects a one-time sign-in token (made with Supabase's
admin `generateLink`, which sends no email) and exchanges it for its own session. Codes last 10
minutes and are deleted once used. Only the function can read the table.

## Installing it on the TV

Expo Go isn't available for TVs, so the TV needs the APK. The easy way, with updates that arrive
by themselves, is from GitHub Releases with Obtainium: see [APP_UPDATES.md](APP_UPDATES.md).

To build an APK by hand instead (free Expo account):

```bash
cd mobile
npx eas-cli@latest build --profile preview --platform android
```

That gives an APK link. Install it with the **Downloader** app (see APP_UPDATES.md for turning on
unknown sources) or with adb: turn on network debugging on the TV, then `adb connect <tv-ip>` and
`adb install <file>.apk`.

The app then shows up in the TV's apps row with a What to Watch banner. The same APK installs on an
Android phone too (and there Google sign-in uses `whattowatch://`, so no tunnel is needed).

## Trying the TV layout without a TV

- **Android TV emulator** (Android Studio → Device Manager → Television 1080p), then
  `npx expo run:android` or install the APK.
- **Any screen:** start with `EXPO_PUBLIC_FORCE_TV=1 npx expo start` to force the TV layout.
  The arrow keys of a keyboard work like the D-pad on Android.

## Code

| Path | What it does |
| --- | --- |
| `src/lib/tv.ts` | `isTV`, and `px()` which scales the 1920 x 1080 design to the screen |
| `src/tv/TvApp.tsx` | Tabs, Back button, opening details and panels |
| `src/tv/focus.tsx` | Focus ring, focus layers (panels trap focus, focus comes back on close) |
| `src/tv/HomePage.tsx`, `ExplorePage.tsx`, `WatchlistPage.tsx`, `GridPage.tsx` | The sections |
| `src/tv/DetailsPage.tsx`, `FilterPanel.tsx`, `AccountPanel.tsx` | Details, filters, account |
| `src/tv/TvSignIn.tsx`, `src/lib/tv-sign-in.ts`, `src/components/TvApprove.tsx` | TV sign-in, TV and phone sides |
| `src/state/use-titles.ts` | Loading and moving titles, shared with the phone's lists |
| `plugins/with-android-tv.js` | Adds the TV launcher entry and banner to the Android build |

The phone and TV share everything under `src/lib` and `src/state`: Supabase queries, sign-in,
filters, moves with Undo, and card formatting.
