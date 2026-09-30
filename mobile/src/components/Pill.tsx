import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, font, radius } from '../theme';

type Tone = 'go' | 'route' | 'warn' | 'muted';
const tones: Record<Tone, { fg: string; bg: string }> = {
  go: { fg: colors.go, bg: 'rgba(0,230,118,0.12)' },
  route: { fg: colors.route, bg: 'rgba(56,189,248,0.12)' },
  warn: { fg: colors.warn, bg: 'rgba(251,191,36,0.12)' },
  muted: { fg: colors.textMuted, bg: 'rgba(148,163,184,0.12)' },
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
