import { Image } from 'expo-image';
import { memo, useState, type ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { StarRating } from './StarRating';
import { formatWatched, yearLabel } from '../lib/format';
import { colors, fonts } from '../lib/theme';
import type { Action, CardTitle, ReleaseInfo, ReleaseStatus, WhereToWatch } from '../lib/types';
import {
  BanIcon,
  CheckIcon,
  DownloadIcon,
  DriveIcon,
  ExternalIcon,
  EyeOffIcon,
  PlusIcon,
  MetacriticIcon,
} from './Icons';

/** Metacritic's own bands: green 61+, yellow 40 to 60, red below 40. */
export function metascoreColour(score: number) {
  if (score >= 61) return '#00ce7a';
  if (score >= 40) return '#ffbd3f';
  return '#ff6874';
}

export type CardKind = 'home' | 'explore' | 'watchlist' | 'history';

type Props = {
  item: CardTitle;
  kind: CardKind;
  onAction: (item: CardTitle, action: Action) => void;
  onRate?: (item: CardTitle, rating: number | null) => void;
};

const TAG: Record<CardKind, string | null> = { home: null, explore: 'New to you', watchlist: 'To get', history: 'Watched' };

/** A steady colour per title for posters that have no image yet. */
function posterColour(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${h}, 45%, 28%)`;
}

function Poster({ item, kind }: { item: CardTitle; kind: CardKind }) {
  const [failed, setFailed] = useState(false);
  const tag = TAG[kind];
  const showImage = item.posterUrl && !failed;
  return (
    <View style={[styles.poster, { backgroundColor: posterColour(item.name) }, kind === 'history' && styles.posterDim]}>
      {showImage ? (
        <Image
          source={{ uri: item.posterUrl! }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={150}
          recyclingKey={String(item.id)}
          onError={() => setFailed(true)}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={styles.posterText}>
          <Text style={styles.posterTitle} numberOfLines={5}>
            {item.name.toUpperCase()}
          </Text>
          <Text style={styles.posterYear}>{item.year}</Text>
        </View>
      )}
      {kind === 'history' && <View style={styles.posterShade} />}
      {tag && (
        <View style={styles.tag}>
          <Text style={styles.tagText}>{tag.toUpperCase()}</Text>
        </View>
      )}
    </View>
  );
}

export function Scores({ imdb, metacritic }: { imdb: number | null; metacritic: number | null }) {
  return (
    <View style={styles.scores}>
      <View
        style={styles.score}
        accessible
        accessibilityLabel={imdb !== null ? `IMDb ${imdb.toFixed(1)}` : 'No IMDb score yet'}
      >
        <View style={styles.imdbBadge}>
          <Text style={styles.imdbText}>IMDb</Text>
        </View>
        <Text style={[styles.scoreText, imdb === null && styles.scoreEmpty]}>{imdb !== null ? imdb.toFixed(1) : '–'}</Text>
      </View>
      <View
        style={styles.score}
        accessible
        accessibilityLabel={metacritic !== null ? `Metacritic ${metacritic}` : 'No Metacritic score yet'}
      >
        <View style={metacritic === null && { opacity: 0.45 }}>
          <MetacriticIcon />
        </View>
        {metacritic !== null ? (
          <View style={[styles.metaBox, { backgroundColor: metascoreColour(metacritic) }]}>
            <Text style={styles.metaText}>{metacritic}</Text>
          </View>
        ) : (
          <Text style={[styles.scoreText, styles.scoreEmpty]}>–</Text>
        )}
      </View>
    </View>
  );
}

const RELEASE_COLOURS: Record<ReleaseStatus, string> = {
  upcoming: '#9c9ca5',
  premiered: '#b48cff',
  in_cinemas: '#ffbd3f',
  digital: '#4fbf7a',
  physical: '#5fa8ff',
  on_tv: '#5fa8ff',
};

/** Release status for Explore and Watchlist, e.g. "In cinemas only · Since 14 Nov · Digital on 3 Dec". */
function ReleaseRow({ release }: { release: ReleaseInfo }) {
  const colour = RELEASE_COLOURS[release.status];
  return (
    <View style={styles.release} accessible accessibilityLabel={[release.label, release.detail].filter(Boolean).join('. ')}>
      <View style={[styles.releasePill, { borderColor: colour }]}>
        <View style={[styles.releaseDot, { backgroundColor: colour }]} />
        <Text style={[styles.releaseLabel, { color: colour }]}>{release.label}</Text>
      </View>
      {release.detail && <Text style={styles.releaseDetail}>{release.detail}</Text>}
    </View>
  );
}

function ServiceMark({ w }: { w: WhereToWatch }) {
  if (w.kind === 'local') {
    return (
      <View style={styles.local} accessible accessibilityLabel={`On your drive: ${w.name}`}>
        <DriveIcon color={colors.text} />
        <Text style={styles.localText}>Drive</Text>
      </View>
    );
  }
  const body = w.logoUrl ? (
    <Image source={{ uri: w.logoUrl }} style={styles.logo} contentFit="cover" />
  ) : (
    <View style={styles.wordmark}>
      <Text style={styles.wordmarkText}>{w.name.toUpperCase()}</Text>
    </View>
  );
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Watch on ${w.name}`}
      disabled={!w.url}
      hitSlop={6}
      onPress={() => w.url && Linking.openURL(w.url)}
    >
      {body}
    </Pressable>
  );
}

type BtnProps = {
  label: string;
  icon: ReactNode;
  onPress: () => void;
  variant?: 'default' | 'primary' | 'download' | 'letterboxd';
  style?: object;
};
function ActionButton({ label, icon, onPress, variant = 'default', style }: BtnProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.act, styles[`act_${variant}`], pressed && styles.actPressed, style]}
    >
      {icon}
      <Text style={[styles.actText, styles[`actText_${variant}`]]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function TitleCardInner({ item, kind, onAction, onRate }: Props) {
  const [open, setOpen] = useState(false);
  const act = (a: Action) => () => onAction(item, a);

  let meta: ReactNode = null;
  let actions: ReactNode = null;
  if (kind === 'home') {
    meta = (
      <>
        <Scores imdb={item.imdb} metacritic={item.metacritic} />
        <View style={styles.where}>
          {item.where.map((w, i) => (
            <ServiceMark key={i} w={w} />
          ))}
        </View>
      </>
    );
    actions = (
      <View style={styles.actions}>
        <ActionButton label="Watched" icon={<CheckIcon color={colors.text} />} onPress={act('watched')} />
        <ActionButton label="Hide" icon={<EyeOffIcon color={colors.text} />} onPress={act('hide')} />
      </View>
    );
  } else if (kind === 'explore') {
    meta = <Scores imdb={item.imdb} metacritic={item.metacritic} />;
    actions = (
      <View style={styles.actionsCol}>
        <ActionButton label="Add to Watchlist" variant="primary" icon={<PlusIcon />} onPress={act('watchlist')} />
        <View style={styles.actions}>
          <ActionButton label="Watched" icon={<CheckIcon color={colors.text} />} onPress={act('watched')} />
          <ActionButton label="Remove" icon={<BanIcon color={colors.text} />} onPress={act('remove')} />
        </View>
      </View>
    );
  } else if (kind === 'watchlist') {
    meta = <Scores imdb={item.imdb} metacritic={item.metacritic} />;
    actions = (
      <View style={styles.actions}>
        <ActionButton
          label="Mark as downloaded"
          variant="download"
          icon={<DownloadIcon color={colors.okText} />}
          onPress={act('downloaded')}
        />
      </View>
    );
  } else {
    meta = (
      <View style={styles.rateRow}>
        <Text style={styles.watchedOn}>{formatWatched(item.watchedAt)}</Text>
        {onRate && <StarRating value={item.rating} onChange={(v) => onRate(item, v)} />}
      </View>
    );
    actions = (
      <View style={styles.actions}>
        <ActionButton
          label={item.type === 'movie' ? 'Open on Letterboxd' : 'Find on Letterboxd'}
          variant="letterboxd"
          icon={<ExternalIcon color={colors.letterboxdText} />}
          onPress={() => Linking.openURL(item.letterboxdUrl)}
        />
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Poster item={item} kind={kind} />
      <View style={styles.body}>
        <Text style={styles.title}>
          {item.name}
          <Text style={styles.year}>  {yearLabel(item.year, item.endYear, item.type)}</Text>
        </Text>
        {item.genres.length > 0 && (
          <View style={styles.genres}>
            {item.genres.map((g) => (
              <View key={g} style={styles.genre}>
                <Text style={styles.genreText}>{g.toUpperCase()}</Text>
              </View>
            ))}
          </View>
        )}
        <Pressable onPress={() => setOpen((o) => !o)} accessibilityHint="Shows the full synopsis">
          <Text style={styles.synopsis} numberOfLines={open ? undefined : 4}>
            {item.synopsis}
          </Text>
        </Pressable>
        {item.cast.length > 0 && (
          <Text style={styles.cast} numberOfLines={2}>
            Starring <Text style={styles.castName}>{item.cast.join(', ')}</Text>
          </Text>
        )}
        {(kind === 'explore' || kind === 'watchlist') && item.release && <ReleaseRow release={item.release} />}
        <View style={styles.meta}>{meta}</View>
        {actions}
      </View>
    </View>
  );
}

export const TitleCard = memo(TitleCardInner);

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 16, overflow: 'hidden', flexDirection: 'row' },
  poster: { width: 112, minHeight: 168, justifyContent: 'flex-end', overflow: 'hidden' },
  posterDim: { opacity: 0.75 },
  posterShade: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(27,27,30,0.25)' },
  posterText: { padding: 10 },
  posterTitle: { color: '#fff', fontFamily: fonts.display, fontSize: 16, lineHeight: 16 },
  posterYear: { color: 'rgba(255,255,255,0.8)', fontFamily: fonts.bodySemi, fontSize: 10, letterSpacing: 1.4, marginTop: 4 },
  tag: { position: 'absolute', top: 8, left: 8, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3 },
  tagText: { color: '#fff', fontFamily: fonts.bodyHeavy, fontSize: 9.5, letterSpacing: 0.6 },
  body: { flex: 1, minWidth: 0, paddingTop: 12, paddingHorizontal: 12, paddingBottom: 10, gap: 8 },
  title: { color: colors.text, fontFamily: fonts.display, fontSize: 18, lineHeight: 20 },
  year: { color: colors.muted, fontFamily: fonts.bodyMedium, fontSize: 12 },
  genres: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  genre: { borderWidth: 1, borderColor: colors.line, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  genreText: { color: colors.muted, fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 0.7 },
  synopsis: { color: colors.synopsis, fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18 },
  cast: { color: colors.muted, fontFamily: fonts.body, fontSize: 12 },
  castName: { color: colors.text, fontFamily: fonts.bodySemi },
  meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  scores: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  score: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  imdbBadge: { backgroundColor: colors.imdb, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 2 },
  imdbText: { color: '#000', fontFamily: fonts.display, fontSize: 11, lineHeight: 12 },
  scoreText: { color: colors.text, fontFamily: fonts.bodyBold, fontSize: 13, fontVariant: ['tabular-nums'] },
  scoreEmpty: { color: colors.muted },
  metaBox: { minWidth: 24, height: 20, borderRadius: 4, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  metaText: { color: '#fff', fontFamily: fonts.bodyHeavy, fontSize: 12, fontVariant: ['tabular-nums'] },
  where: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 6 },
  logo: { width: 24, height: 24, borderRadius: 6 },
  wordmark: { height: 22, borderRadius: 5, paddingHorizontal: 6, backgroundColor: '#b20710', justifyContent: 'center' },
  wordmarkText: { color: '#fff', fontFamily: fonts.display, fontSize: 11 },
  local: {
    height: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    borderRadius: 6,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.line,
  },
  localText: { color: colors.text, fontFamily: fonts.display, fontSize: 11 },
  release: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 8, rowGap: 4 },
  releasePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  releaseDot: { width: 6, height: 6, borderRadius: 3 },
  releaseLabel: { fontFamily: fonts.bodyBold, fontSize: 11.5 },
  releaseDetail: { color: colors.muted, fontFamily: fonts.body, fontSize: 11.5 },
  rateRow: { gap: 6 },
  watchedOn: { color: colors.muted, fontFamily: fonts.body, fontSize: 12 },
  actionsCol: { gap: 8, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  act: {
    flexGrow: 1,
    flexBasis: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: 9,
    paddingVertical: 9,
    paddingHorizontal: 2,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
  },
  act_default: {},
  act_primary: { backgroundColor: colors.red, borderColor: colors.red, flexBasis: 'auto' },
  act_download: { backgroundColor: colors.okTint, borderColor: colors.okBorder },
  act_letterboxd: { borderColor: colors.letterboxdBorder },
  actPressed: { opacity: 0.7 },
  actText: { color: colors.text, fontFamily: fonts.bodyBold, fontSize: 12.5 },
  actText_default: {},
  actText_primary: { color: '#fff' },
  actText_download: { color: colors.okText },
  actText_letterboxd: { color: colors.letterboxdText },
});
