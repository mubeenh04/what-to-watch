import { Tabs } from 'expo-router/js-tabs';

import { BookmarkIcon, CompassIcon, HomeIcon } from '../../components/Icons';
import { colors, fonts } from '../../lib/theme';
import { useAppData } from '../../state/app-data';

export default function TabsLayout() {
  const { watchlistCount } = useAppData();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.app },
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.nav, borderTopColor: colors.line, borderTopWidth: 1 },
        tabBarLabelStyle: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 0.4 },
        tabBarBadgeStyle: { backgroundColor: colors.red, color: '#fff', fontFamily: fonts.bodyBold, fontSize: 10 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused }) => <HomeIcon color={focused ? colors.red : colors.muted} />,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Explore',
          tabBarIcon: ({ focused }) => <CompassIcon color={focused ? colors.red : colors.muted} />,
        }}
      />
      <Tabs.Screen
        name="watchlist"
        options={{
          title: 'Watchlist',
          tabBarBadge: watchlistCount > 0 ? watchlistCount : undefined,
          tabBarIcon: ({ focused }) => <BookmarkIcon color={focused ? colors.red : colors.muted} />,
        }}
      />
    </Tabs>
  );
}
