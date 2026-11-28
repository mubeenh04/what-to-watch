import { Dimensions, Platform } from 'react-native';

/**
 * True on Google TV / Android TV (Android reports a television UI mode). The same app then shows
 * the TV layout instead of the phone tabs. EXPO_PUBLIC_FORCE_TV=1 shows the TV layout anywhere,
 * which is handy for checking it in an Android TV emulator or on a computer.
 */
export const isTV = Platform.isTV || process.env.EXPO_PUBLIC_FORCE_TV === '1';

/**
 * The TV designs are drawn at 1920 x 1080. Android TV usually reports 960 x 540 points (2x
 * density), so every design pixel is scaled by the screen width: px(96) is the 96 px side margin.
 */
const scale = () => {
  const { width, height } = Dimensions.get('window');
  // Landscape always on a TV; guard against a portrait window in a preview.
  return Math.max(width, height) / 1920;
};
const S = scale();
export const px = (n: number) => Math.round(n * S * 2) / 2;

/** Overscan safe area from the design: 96 px at the sides, 54 px top and bottom. */
export const SAFE_X = px(96);
export const SAFE_Y = px(54);
