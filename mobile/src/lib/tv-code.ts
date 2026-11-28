// Pure helpers for TV sign-in codes (tested in tests/tv-code.test.ts).

/** "K7P4QX" -> "K7P 4QX", the way the TV shows it. */
export const formatTvCode = (code: string) => code.replace(/^(.{3})(.{3})$/, '$1 $2');

/** Opens the phone app on the approve screen with the code filled in (installed app only). */
export const tvSignInLink = (code: string) => `whattowatch://tv-sign-in?code=${code}`;

/** Accepts what people type: spaces, dashes, lower case. */
export const cleanTvCode = (raw: string) => raw.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 6);
