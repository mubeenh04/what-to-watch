import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts } from '../lib/theme';

type ToastOpts = { undo?: () => void; error?: boolean };
type ShowToast = (message: string, opts?: ToastOpts) => void;

const Ctx = createContext<ShowToast>(() => {});

/** Bottom toast with an optional Undo, like the mockup. `bottom` keeps it above the tab bar. */
export function ToastProvider({
  children,
  bottom = 90,
  inset = 14,
}: {
  children: ReactNode;
  bottom?: number;
  /** Space at the left and right. The TV keeps the toast narrow and centred. */
  inset?: number;
}) {
  const [toast, setToast] = useState<{ message: string; opts: ToastOpts; key: number } | null>(null);
  const anim = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    Animated.timing(anim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => setToast(null));
  }, [anim]);

  const show = useCallback<ShowToast>(
    (message, opts = {}) => {
      if (timer.current) clearTimeout(timer.current);
      setToast({ message, opts, key: Date.now() });
      Animated.timing(anim, { toValue: 1, duration: 220, useNativeDriver: true }).start();
      timer.current = setTimeout(hide, opts.error ? 5000 : 4000);
    },
    [anim, hide],
  );

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <Ctx.Provider value={show}>
      <View style={{ flex: 1 }}>
        {children}
        {toast && (
          <Animated.View
            accessibilityLiveRegion="polite"
            style={[
              styles.toast,
              { bottom, left: inset, right: inset },
              toast.opts.error && styles.error,
              { opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] },
            ]}
          >
            <Text style={[styles.msg, toast.opts.error && { color: colors.text }]} numberOfLines={2}>
              {toast.message}
            </Text>
            {toast.opts.undo && (
              <Pressable
                hitSlop={10}
                accessibilityRole="button"
                onPress={() => {
                  toast.opts.undo?.();
                  hide();
                }}
              >
                <Text style={styles.undo}>UNDO</Text>
              </Pressable>
            )}
          </Animated.View>
        )}
      </View>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: 14,
    right: 14,
    backgroundColor: colors.toast,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  error: { backgroundColor: colors.redDeep },
  msg: { flex: 1, color: colors.toastText, fontFamily: fonts.bodySemi, fontSize: 13 },
  undo: { color: colors.redDeep, fontFamily: fonts.bodyHeavy, fontSize: 12, letterSpacing: 0.8 },
});
