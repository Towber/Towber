import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { font, light } from '../theme';

export const TOPBAR_HEIGHT = 56; // content height, excluding the status-bar inset

// Two-line "hamburger", as in the Uber mobile menu.
export function MenuIcon({ color = light.onHeader }: { color?: string }) {
  return (
    <View style={s.menuIcon}>
      <View style={[s.menuLine, { backgroundColor: color }]} />
      <View style={[s.menuLine, { backgroundColor: color }]} />
    </View>
  );
}

// Black top bar: wordmark on the left, white pill + menu on the right.
export function TopBar({ onMenu, onSos }: { onMenu: () => void; onSos: () => void }) {
  const { top } = useSafeAreaInsets();
  return (
    <View style={[s.bar, { paddingTop: top, height: top + TOPBAR_HEIGHT }]}>
      <Text style={s.brand} accessibilityRole="header">Towber</Text>
      <View style={s.right}>
        <Pressable accessibilityRole="button" accessibilityLabel="Emergency SOS, call 112" onPress={onSos} style={s.pill}>
          <Text style={s.pillText}>SOS</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Open menu" onPress={onMenu} hitSlop={10} style={s.menuHit}>
          <MenuIcon />
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  bar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, backgroundColor: light.header, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  brand: { color: light.onHeader, fontFamily: font.bold, fontSize: 28, letterSpacing: -0.8 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  pill: { height: 40, paddingHorizontal: 20, borderRadius: 999, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  pillText: { color: light.danger, fontFamily: font.bold, fontSize: 15 },
  menuHit: { width: 32, height: 40, alignItems: 'center', justifyContent: 'center' },
  menuIcon: { width: 26, gap: 7 },
  menuLine: { height: 3, borderRadius: 1.5, width: 26 },
});
