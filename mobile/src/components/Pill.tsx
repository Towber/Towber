import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { font, light, radius } from '../theme';

type Tone = 'go' | 'route' | 'warn' | 'muted';
const tones: Record<Tone, { fg: string; bg: string }> = {
  go: { fg: light.go, bg: light.goSoft },
  route: { fg: light.route, bg: light.routeSoft },
  warn: { fg: light.warn, bg: 'rgba(180,83,9,0.10)' },
  muted: { fg: light.textMuted, bg: 'rgba(107,114,128,0.12)' },
};

export function Pill({ label, tone = 'muted' }: { label: string; tone?: Tone }) {
  const t = tones[tone];
  return (
    <View style={[s.pill, { backgroundColor: t.bg }]}>
      <View style={[s.dot, { backgroundColor: t.fg }]} />
      <Text style={[s.text, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, gap: 6, alignSelf: 'flex-start' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontFamily: font.semibold, fontSize: 11 },
});
