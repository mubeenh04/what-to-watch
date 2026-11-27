import { Redirect } from 'expo-router';

// On Android the Google sign-in return link (…/auth/callback) can also reach the router.
// The sign-in itself is handled in lib/google-auth.ts, so just go to Home.
export default function AuthCallback() {
  return <Redirect href="/" />;
}
