import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type PlaceSuggestion } from '../api';
import { font, light } from '../theme';
import { TOPBAR_HEIGHT } from './TopBar';

type Props = {
  pickupLabel: string;
  pickupValue: string;
  pickupEditing: boolean;
  activeSearch: 'pickup' | 'destination';
  busy: boolean;
  suggestions: PlaceSuggestion[];
  searchError?: string | null;
  routeSummary?: string | null;
  onPickupFocus: () => void;
  onPickupQueryChange: (query: string) => void;
  onDestinationFocus: () => void;
  onQueryChange: (query: string) => void;
  onSubmit: (query: string) => void;
  onSelect: (suggestion: PlaceSuggestion) => void;
};

export function SearchBar({ pickupLabel, pickupValue, pickupEditing, activeSearch, busy, suggestions, searchError, routeSummary, onPickupFocus, onPickupQueryChange, onDestinationFocus, onQueryChange, onSubmit, onSelect }: Props) {
  const { top } = useSafeAreaInsets();
  const [q, setQ] = useState('');
  return (
    <View style={[s.wrap, { top: top + TOPBAR_HEIGHT + 12 }]} pointerEvents="box-none">
      <View style={s.glass}>
        <View style={s.row}>
          <View style={[s.dot, { backgroundColor: light.go }]} />
          <TextInput
            value={pickupEditing ? pickupValue : pickupLabel}
            onFocus={onPickupFocus}
            onChangeText={onPickupQueryChange}
            placeholder="Your location"
            placeholderTextColor={light.textMuted}
            style={s.pickup}
            returnKeyType="search"
            accessibilityLabel="Pickup location"
          />
        </View>
        <View style={s.divider} />
        <View style={s.row}>
          <View style={[s.dot, { backgroundColor: light.text, borderRadius: 2 }]} />
          <TextInput
            value={q}
            onFocus={onDestinationFocus}
            onChangeText={(text) => { setQ(text); onQueryChange(text); }}
            placeholder="Where should we tow it?"
            placeholderTextColor={light.textMuted}
            style={s.input}
            returnKeyType="search"
            onSubmitEditing={() => q.trim() && onSubmit(q.trim())}
            accessibilityLabel="Tow destination"
          />
          {busy ? <ActivityIndicator color={light.go} /> : <Ionicons name="search" size={18} color={light.textMuted} />}
        </View>
        {routeSummary ? <Text style={s.routeSummary}>{routeSummary}</Text> : null}
      </View>
      {searchError || suggestions.length > 0 ? (
        <View style={s.results}>
          {searchError ? <Text style={s.error}>{searchError}</Text> : suggestions.map((suggestion) => (
            <Pressable
              key={suggestion.placeId}
              accessibilityRole="button"
              accessibilityLabel={`Select ${suggestion.description}`}
              onPress={() => { if (activeSearch === 'destination') setQ(suggestion.description); onSelect(suggestion); }}
              style={s.result}
            >
              <Ionicons name="location-outline" size={18} color={light.go} />
              <View style={s.resultText}>
                <Text style={s.primary} numberOfLines={1}>{suggestion.primaryText}</Text>
                {suggestion.secondaryText ? <Text style={s.secondary} numberOfLines={1}>{suggestion.secondaryText}</Text> : null}
              </View>
            </Pressable>
          ))}
          <Text style={s.attribution}>Powered by Google</Text>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16 },
  glass: { borderRadius: 16, backgroundColor: light.surface, paddingHorizontal: 16, elevation: 6, shadowColor: '#000000', shadowOpacity: 0.14, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 48 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  pickup: { flex: 1, color: light.textMuted, fontFamily: font.medium, fontSize: 15 },
  input: { flex: 1, color: light.text, fontFamily: font.semibold, fontSize: 15 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: light.border, marginLeft: 22 },
  routeSummary: { color: light.route, fontFamily: font.semibold, fontSize: 12, paddingBottom: 10, paddingLeft: 22 },
  results: { marginTop: 8, borderRadius: 16, overflow: 'hidden', backgroundColor: light.surface, elevation: 6, shadowColor: '#000000', shadowOpacity: 0.14, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  result: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: light.border },
  resultText: { flex: 1, gap: 3 },
  primary: { color: light.text, fontFamily: font.semibold, fontSize: 14 },
  secondary: { color: light.textMuted, fontFamily: font.medium, fontSize: 12 },
  error: { color: light.textMuted, fontFamily: font.medium, fontSize: 13, padding: 16 },
  attribution: { color: light.textMuted, fontFamily: font.medium, fontSize: 10, textAlign: 'right', paddingHorizontal: 12, paddingVertical: 6 },
});
