// D-pad focus for the TV layout. Android TV moves focus between focusable views by itself; this
// file adds the visible focus state, a way to switch a whole layer off while a panel is open, and
// a way to put focus back where it was when the panel closes.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

import { colors } from '../lib/theme';
import { px } from '../lib/tv';

type Layer = {
  /** False while a panel or the details page covers this layer: nothing in it can take focus. */
  enabled: boolean;
  /** The focusKey that should take focus now (after a panel closes), or null. */
  restoreKey: string | null;
  remember: (key: string) => void;
};

const LayerCtx = createContext<Layer>({ enabled: true, restoreKey: null, remember: () => {} });

/**
 * A focus layer. While `enabled` is false its buttons can't be focused, so the D-pad stays inside
 * the panel on top. When it turns back on, focus returns to the last button focused in it.
 */
export function FocusLayer({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const last = useRef<string | null>(null);
  const [restoreKey, setRestoreKey] = useState<string | null>(null);
  const wasEnabled = useRef(enabled);

  useEffect(() => {
    if (enabled && !wasEnabled.current && last.current) {
      setRestoreKey(last.current);
      const t = setTimeout(() => setRestoreKey(null), 400);
      wasEnabled.current = enabled;
      return () => clearTimeout(t);
    }
    wasEnabled.current = enabled;
  }, [enabled]);

  const remember = useCallback((key: string) => {
    last.current = key;
  }, []);
  const value = useMemo(() => ({ enabled, restoreKey, remember }), [enabled, restoreKey, remember]);
  return <LayerCtx.Provider value={value}>{children}</LayerCtx.Provider>;
}

/**
 * True for a moment after pulse(). Passed as `preferred` it moves focus to a button on demand,
 * e.g. to the Add button after OK on a poster.
 */
export function usePulse(): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulse = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setOn(true);
    timer.current = setTimeout(() => setOn(false), 400);
  }, []);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return [on, pulse];
}

type Props = Omit<PressableProps, 'style' | 'children'> & {
  style?: StyleProp<ViewStyle> | ((focused: boolean) => StyleProp<ViewStyle>);
  children?: ReactNode | ((focused: boolean) => ReactNode);
  /** Identifies this button so focus can come back to it. Unique within its layer. */
  focusKey?: string;
  /** Take focus now (on mount, or whenever this turns true). */
  preferred?: boolean;
  /** 'ring' (white ring and red glow, the default) or 'none' when the button shows focus itself. */
  ring?: 'ring' | 'none';
  /** Grow a little when focused (posters). */
  lift?: boolean;
  radius?: number;
};

export const focusRing = (radius: number): ViewStyle => ({
  outlineColor: '#ffffff',
  outlineWidth: px(5),
  outlineOffset: px(4),
  outlineStyle: 'solid',
  borderRadius: radius,
  boxShadow: `0 0 0 ${px(12)}px rgba(227,48,60,0.35), 0 ${px(24)}px ${px(60)}px rgba(0,0,0,0.6)`,
});

/** A button the remote can reach. OK presses it. Shows the white focus ring from the designs. */
export function Focusable({
  style,
  children,
  focusKey,
  preferred,
  ring = 'ring',
  lift,
  radius = px(14),
  onFocus,
  onBlur,
  disabled,
  ...rest
}: Props) {
  const layer = useContext(LayerCtx);
  const [focused, setFocused] = useState(false);
  const canFocus = layer.enabled && !disabled;
  const wantFocus = canFocus && (!!preferred || (!!focusKey && layer.restoreKey === focusKey));

  useEffect(() => {
    if (!canFocus) setFocused(false);
  }, [canFocus]);

  return (
    <Pressable
      {...rest}
      disabled={disabled}
      focusable={canFocus}
      hasTVPreferredFocus={wantFocus}
      onFocus={(e) => {
        setFocused(true);
        if (focusKey) layer.remember(focusKey);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
      style={[
        typeof style === 'function' ? style(focused) : style,
        focused && ring === 'ring' && focusRing(radius),
        focused && lift && { transform: [{ scale: 1.08 }], zIndex: 2 },
      ]}
    >
      {typeof children === 'function' ? children(focused) : children}
    </Pressable>
  );
}

export const tvColors = {
  ...colors,
  chip: '#2e2e33',
  chipOn: '#eeeef0',
  panel: '#202024',
  dim: '#a6a6af',
  netflix: '#b20710',
};
