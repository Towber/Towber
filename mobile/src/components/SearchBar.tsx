import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font } from '../theme';

type Props = { pickupLabel: string; busy: boolean; onSubmit: (query: string) => void };

export function SearchBar({ pickupLabel, busy, onSubmit }: Props) {
  const { top } = useSafeAreaInsets();
  const [q, setQ] = useState('');
  return (
    <View style={[s.wrap, { top: top + 12 }]} pointerEvents="box-none">
      <BlurView intensity={40} tint="dark" style={s.glass}>
        <View style={s.row}>
          <View style={[s.dot, { backgroundColor: colors.go }]} />
          <Text style={s.pickup} numberOfLines={1}>{pickupLabel}</Text>
        </View>
        <View style={s.divider} />
        <View style={s.row}>
          <View style={[s.dot, { backgroundColor: colors.route, borderRadius: 2 }]} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Where should we tow it?"
            placeholderTextColor={colors.textMuted}
            style={s.input}
            returnKeyType="search"
            onSubmitEditing={() => q.trim() && onSubmit(q.trim())}
            accessibilityLabel="Tow destination"
          />
          {busy ? <ActivityIndicator color={colors.route} /> : <Ionicons name="search" size={18} color={colors.textMuted} />}
        </View>
      </BlurView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16 },
  glass: { borderRadius: 20, overflow: 'hidden', backgroundColor: 'rgba(15,23,42,0.6)', borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 48 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  pickup: { flex: 1, color: colors.textMuted, fontFamily: font.medium, fontSize: 15 },
  input: { flex: 1, color: colors.text, fontFamily: font.semibold, fontSize: 15 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 22 },
});
