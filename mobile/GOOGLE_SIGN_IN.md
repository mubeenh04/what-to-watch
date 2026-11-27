# Setting up Google sign-in

The app code is ready. Google sign-in starts working after three one-off steps: make a Google
login key, give it to Supabase, and tell Supabase it may send people back to the app. No SQL is
needed: your existing database and lists are untouched.

Your Supabase project's sign-in address (you need it in step 1):

```
https://ezedrdpzhgtwrfjmupvf.supabase.co/auth/v1/callback
```

## 1. Google Cloud: make the login key (about 10 minutes)

1. Go to <https://console.cloud.google.com/> and sign in with your Google account.
2. At the top, click the project picker → **New project**. Name it `What to Watch` → **Create**,
   then make sure it is selected.
3. Left menu → **APIs & Services** → **OAuth consent screen** (it may be called **Google Auth
   Platform** → **Branding**). Click **Get started**:
   - App name: `What to Watch`. Support email: your Gmail.
   - Audience: **External**.
   - Contact email: your Gmail. Agree and **Create**.
4. Still in that area, open **Audience**. While the app is in **Testing**, only people listed under
   **Test users** can sign in, so click **Add users** and add every Gmail address that will use the
   app (yours and your household's). You can click **Publish app** later instead; for the basic
   name/email/photo access this app asks for, Google does not need to review it.
5. Open **Data access** (or **Scopes**) → **Add or remove scopes** → tick `.../auth/userinfo.email`,
   `.../auth/userinfo.profile` and `openid` → **Update** → **Save**.
6. Open **Clients** (or **Credentials** → **Create credentials** → **OAuth client ID**):
   - Application type: **Web application** (yes, web, even though it's a phone app: the phone
     goes through Supabase's web address).
   - Name: `Supabase`.
   - **Authorized redirect URIs** → **Add URI** → paste the Supabase address above.
   - **Create**. Copy the **Client ID** and **Client secret** that appear (keep the secret private;
     don't put it in the app or in chat).

## 2. Supabase: switch on Google

1. Go to <https://supabase.com/dashboard/project/ezedrdpzhgtwrfjmupvf/auth/providers>
   (Authentication → Sign In / Providers).
2. Click **Google** → turn on **Enable Sign in with Google**.
3. Paste the **Client ID** and **Client secret** from step 1 → **Save**.
4. On the same page, under the user sign-up settings, turn on **Allow manual linking** → **Save**.
   This is what lets an existing member link a Google account with a different email address.

## 3. Supabase: let it send people back to the app

1. Go to <https://supabase.com/dashboard/project/ezedrdpzhgtwrfjmupvf/auth/url-configuration>
   (Authentication → URL Configuration).
2. Under **Redirect URLs** click **Add URL** and add these two, one at a time:
   ```
   exp://**
   whattowatch://**
   ```
   The first is for testing in Expo Go (its address changes with your Wi-Fi, so it's a wildcard).
   The second is for the installed app later. **Save**.

## Trying it

Restart the app (`npx expo start`, scan the QR code again).

- **New people:** tap **Sign up with Google** (or **Sign in with Google**, it's the same thing).
  Choose the Google account; you land straight in the app and your lists are set up.
- **Existing members, same Gmail address:** just tap **Sign in with Google**. Supabase sees the
  email matches your confirmed account and joins them, so you open your existing lists.
- **Existing members, different address:** sign in with your email and password as usual, tap
  the person icon (top right) → **Link Google account**, pick the Google account. From then on
  either method opens the same account with the same lists. **Unlink** is there too, once you have
  two ways to sign in.

## Expo Go notes

- Google opens in a browser sheet inside Expo Go and then returns to the app. On iPhone you'll see
  a "wants to use supabase.co to sign in" prompt; tap **Continue**.
- If you see "Supabase did not accept the app's return address", step 3 is missing or not saved.
- If you see "Error 400: redirect_uri_mismatch" on Google's page, the address in step 1.6 isn't
  exactly the Supabase one above.
- If you see "Access blocked: app has not completed verification", add that Gmail as a test user
  (step 1.4) or publish the app.
- `npx expo start --tunnel` uses an `exps://…exp.direct` address: add `exps://**` to the Redirect URLs too if you use tunnel mode.
- If Google's page spins after you tap Continue, the Metro terminal on your Mac prints a `[google-auth] return address:` line. In Expo Go it must start with `exp://`.
- A Google account that already has its own What to Watch account can't be linked to a second
  one. The app says so; sign in with Google to use that account instead.

## Security notes

- The Google client secret lives only in Supabase. The app itself holds nothing new.
- The `exp://**` redirect is only needed while testing in Expo Go. When the app is installed as a
  proper build, you can remove it and keep `whattowatch://**`.
