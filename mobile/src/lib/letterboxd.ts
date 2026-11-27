// Letterboxd rating export. Letterboxd has no public write API, so ratings leave the app as a
// CSV in the format its importer reads (letterboxd.com/import), and the user uploads it there.

export type RatedMovie = {
  name: string;
  year: number;
  tmdbId: number | null;
  imdbId: string | null;
  /** Letterboxd stars, 0.5 to 5 in half steps. */
  rating: number;
};

/** Ratings are stored in half-star steps from 0.5 to 5. */
export function normaliseRating(v: number): number | null {
  if (!Number.isFinite(v)) return null;
  const half = Math.round(v * 2) / 2;
  return half >= 0.5 && half <= 5 ? half : null;
}

export function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v);
  // Quote anything with a comma, quote or line break, and neutralise spreadsheet formulas.
  const safe = /^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export const LETTERBOXD_CSV_HEADER = ['tmdbID', 'imdbID', 'Title', 'Year', 'Rating'] as const;

/**
 * CSV for Letterboxd's importer. It matches films by tmdbID or imdbID (title and year are the
 * fallback). No WatchedDate is written on purpose: with a date Letterboxd adds a diary entry on
 * every upload, without one it only marks the film watched and sets the rating, so uploading
 * the same file again never creates duplicates.
 */
export function buildLetterboxdCsv(movies: RatedMovie[]): { csv: string; count: number } {
  const rows = movies
    .map((m) => ({ ...m, rating: normaliseRating(m.rating) }))
    .filter((m): m is RatedMovie => m.rating !== null)
    .sort((a, b) => a.name.localeCompare(b.name) || a.year - b.year);
  const lines = [LETTERBOXD_CSV_HEADER.join(',')];
  for (const m of rows) {
    lines.push([m.tmdbId, m.imdbId, m.name, m.year, m.rating.toFixed(1)].map(csvCell).join(','));
  }
  return { csv: lines.join('\r\n') + '\r\n', count: rows.length };
}
