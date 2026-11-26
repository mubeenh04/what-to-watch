export type TitleType = 'movie' | 'series';
export type Status = 'home' | 'explore' | 'watchlist' | 'history' | 'hidden' | 'removed';
export type Action = 'watched' | 'hide' | 'unhide' | 'watchlist' | 'remove' | 'downloaded' | 'undo';

/** Shape returned by the user_title query in api.ts. */
export type TitleRow = {
  title_id: number;
  status: Status;
  status_changed_at: string;
  watched_at: string | null;
  title: {
    title_id: number;
    title_type: TitleType;
    name: string;
    release_year: number;
    end_year: number | null;
    synopsis: string;
    poster_url: string | null;
    imdb_rating: number | string | null;
    metacritic_score: number | null;
    letterboxd_url: string | null;
    title_genre: { rank: number; genre: { name: string } | null }[] | null;
    title_cast: { billing_order: number; person: { name: string } | null }[] | null;
    title_availability:
      | {
          source_type: 'streaming' | 'local';
          watch_url: string | null;
          streaming_service: { name: string; logo_url: string | null; display_order: number } | null;
          local_drive: { name: string } | null;
        }[]
      | null;
  };
};

export type WhereToWatch =
  | { kind: 'streaming'; name: string; logoUrl: string | null; url: string | null }
  | { kind: 'local'; name: string };

/** What a card shows. Built from a TitleRow by toCard(). */
export type CardTitle = {
  id: number;
  type: TitleType;
  status: Status;
  name: string;
  year: number;
  endYear: number | null;
  synopsis: string;
  posterUrl: string | null;
  imdb: number | null;
  /** Metacritic Metascore, 0 to 100. */
  metacritic: number | null;
  genres: string[];
  cast: string[];
  where: WhereToWatch[];
  letterboxdUrl: string;
  watchedAt: string | null;
};

export type LocationFilter = 'all' | 'streaming' | 'local';

export type HomeFilters = {
  yearFrom: number | null;
  yearTo: number | null;
  genreIds: number[];
  location: LocationFilter;
  imdbMin: number;
  metacriticMin: number;
};

export const emptyFilters: HomeFilters = {
  yearFrom: null,
  yearTo: null,
  genreIds: [],
  location: 'all',
  imdbMin: 0,
  metacriticMin: 0,
};

export type Genre = { genre_id: number; name: string };
