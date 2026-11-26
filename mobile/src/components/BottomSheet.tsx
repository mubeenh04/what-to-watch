import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Dimensions, Easing, Modal, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '../lib/theme';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** The top of the tray: the grab bar sits above it, and both can be dragged down to close. */
  header: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  maxHeight?: `${number}%`;
};

const CLOSE_DISTANCE = 90;
const CLOSE_VELOCITY = 0.9;

/**
 * A tray that slides up from the bottom. Drag the top of it (the grab bar or the title row)
 * down to close, tap the grab bar, tap the dimmed area, or use Android's back button.
 */
export function BottomSheet({ visible, onClose, header, children, footer, maxHeight = '88%' }: Props) {
  const insets = useSafeAreaInsets();
  const screenH = Dimensions.get('window').height;
  const [mounted, setMounted] = useState(visible);
  const translateY = useRef(new Animated.Value(screenH)).current;
  const closing = useRef(false);

  useEffect(() => {
    if (visible) {
      closing.current = false;
      setMounted(true);
      translateY.setValue(screenH);
      Animated.timing(translateY, {
        toValue: 0,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else if (mounted) {
      Animated.timing(translateY, {
        toValue: screenH,
        duration: 220,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(() => setMounted(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const close = () => {
    if (closing.current) return;
    closing.current = true;
    onClose();
  };

  const pan = useRef(
    PanResponder.create({
      // The top of the tray claims touches (buttons inside it, like Reset, still get taps first)...
      onStartShouldSetPanResponder: () => true,
      // ...and takes over from a button as soon as the finger moves down.
      onMoveShouldSetPanResponderCapture: (_e, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_e, g) => translateY.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_e, g) => {
        if (g.dy > CLOSE_DISTANCE || g.vy > CLOSE_VELOCITY) close();
        else Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
      },
      onPanResponderTerminate: () => Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start(),
    }),
  ).current;

  const scrimOpacity = translateY.interpolate({
    inputRange: [0, screenH * 0.6],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  if (!mounted) return null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={close} statusBarTranslucent>
      <Animated.View style={[styles.scrim, { opacity: scrimOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View
        style={[styles.sheet, { maxHeight, paddingBottom: insets.bottom + 12, transform: [{ translateY }] }]}
      >
        <View {...pan.panHandlers} style={styles.top}>
          <Pressable
            onPress={close}
            hitSlop={{ top: 12, bottom: 8, left: 60, right: 60 }}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <View style={styles.grab} />
          </Pressable>
          {header}
        </View>
        {children}
        {footer}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.sheet,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    borderColor: colors.line,
  },
  top: {},
  grab: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.line,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 2,
  },
});
