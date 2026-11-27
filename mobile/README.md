# What to Watch — mobile app

Native Android and iOS app built with React Native and Expo (SDK 58, Expo Router). It reads and
writes the Supabase project `what-to-watch`; titles come from the TMDB sync in `../supabase`.

## Run it on your phone (Expo Go)

You need Node.js 20 or newer on your Mac (`node -v` to check; install from nodejs.org if missing).

1. Install **Expo Go** on your phone from the App Store or Google Play.
2. In Terminal on your Mac:
   ```bash
   cd "what-to-watch/mobile"
   npm install
   cp .env.example .env
   npx expo start
   ```
3. A QR code appears in Terminal.
   - **iPhone:** open the Camera app, point it at the QR code and tap the banner.
   - **Android:** open Expo Go and tap **Scan QR code**.
4. The first time, tap **Sign up with Google** (after the one-off setup in
   [GOOGLE_SIGN_IN.md](GOOGLE_SIGN_IN.md)), or **New here? Create an account**, then confirm the email Supabase sends
   you and sign in. Your first sign-in sorts every title into Home (on Netflix in South Africa or
   on a drive) or Explore (everything else). This takes a few seconds.

The phone and the Mac need to be on the same Wi-Fi. If they can't see each other (for example on
a guest network), run `npx expo start --tunnel` instead.

Saving a file on the Mac reloads the app on the phone straight away.

## What's where

| Path | What it does |
| --- | --- |
| `src/app/_layout.tsx` | Fonts, sign-in gate, first-sign-in profile setup |
| `src/app/(tabs)/` | Home, Explore and Watchlist, with the bottom tab bar |
| `src/components/TitleCard.tsx` | The card: poster, name, two genres, synopsis, two actors, IMDb and Metacritic, where to watch, actions |
| `src/components/FilterSheet.tsx` | Filters per page: Home (year, genre, location, scores), Explore (year, genre, scores, release), Watchlist (release) |
| `src/components/BottomSheet.tsx` | The tray used by Filters and About: drag or tap its top to close |
| `src/components/Pager.tsx` | Swipe left and right between a page's tabs |
| `src/components/TitleList.tsx` | Paged list, moves between sections with Undo |
| `src/lib/api.ts` | Every Supabase query and update |
| `src/lib/google-auth.ts` | Google sign-in, sign-up and linking (Supabase Auth); setup in `GOOGLE_SIGN_IN.md` |
| `src/components/AboutSheet.tsx` | Person icon: sign-in methods (Link Google account), sign out, TMDB credits |
| `src/lib/format.ts` | Turns database rows into cards (tested in `tests/`) |

A title lives in exactly one section. Each button changes the title's `user_title.status`, but
only while it is still in the section the card came from, and logs the move in
`title_status_event`.

| Section | Buttons |
| --- | --- |
| Home | Watched → History, Hide → Hidden (Filters → "Show again" brings hidden titles back) |
| Explore | Add to Watchlist, Watched → History, Remove → block list (never recommended again) |
| Watchlist | Mark downloaded → Home |
| History | Star rating (half stars), Open on Letterboxd. Ratings export from About as a Letterboxd import CSV |

Search (Home): fuzzy matching on titles and the top-billed actors, so typos still match. It uses
the database function `search_my_titles` (migration `20261126194000_title_search.sql`, already
applied). If that function is missing, the app falls back to a plain "name contains" search.

Release status (Explore and Watchlist): cards show e.g. "In cinemas only · Since 14 Nov · Digital on
3 Dec", and the filters can pick statuses. It switches on by itself once the release_status
migration has run; until then the app leaves those columns out.

Scores: IMDb and Metacritic show a dash until the OMDb score job fills them in, and the score
filters stay off until at least one title has a score.

## Checks

```bash
npm run typecheck   # TypeScript
npm test            # unit tests for card formatting
```

## Settings and keys

`.env` holds the Supabase URL and the **publishable** key. Both are public by design: the
database's row-level security only lets each signed-in user see the catalogue and change their own
lists. Never put the service role key, the TMDB key or any other secret in this app.

## Installing it properly later

Expo Go is for development. To install the app like any other app (no Mac running), build it with
EAS: `npx eas-cli@latest build --profile preview --platform android` gives an APK you can install
directly. iPhone installs outside Expo Go need an Apple Developer account ($99 a year) and
`npx eas-cli@latest build --platform ios`.

Posters, titles and cast come from TMDB; where-to-watch data comes from JustWatch through TMDB.
This product uses the TMDB API but is not endorsed or certified by TMDB.
