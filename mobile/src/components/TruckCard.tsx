import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { font, light, radius, zarRange } from '../theme';
import type { Truck } from '../api';
import { Pill } from './Pill';
import { TruckIcon, typeLabel } from './TruckIcon';

export const CARD_WIDTH = 264;

export function TruckCard({ truck, selected, onPress }: { truck: Truck; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${truck.companyName}, ${typeLabel[truck.vehicleType]}, ${truck.etaMin ?? 'a few'} minutes away`}
      style={[s.card, selected && s.selected]}
    >
      <View style={s.top}>
        <View style={[s.icon, selected && { backgroundColor: light.goSoft }]}>
          <TruckIcon type={truck.vehicleType} size={26} color={selected ? light.go : light.route} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.name} numberOfLines={1}>{truck.companyName}</Text>
          <Text style={s.meta}>
            {typeLabel[truck.vehicleType]}{truck.distanceKm != null ? `, ${truck.distanceKm.toFixed(1)} km away` : ''}
          </Text>
        </View>
      </View>

      <Text style={s.price}>{zarRange(truck.priceMin, truck.priceMax)}</Text>

      <View style={s.pills}>
        <Pill tone="go" label={truck.etaMin != null ? `Arriving in ${truck.etaMin} min` : 'En Route'} />
        <Pill tone="route" label="Verified Fleet" />
      </View>
    </Pressable>
  );
}

export function TruckCardSkeleton() {
  const opacity = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View style={[s.card, { opacity, height: 150 }]}>
      <View style={[s.bar, { width: '60%' }]} />
      <View style={[s.bar, { width: '40%' }]} />
      <View style={[s.bar, { width: '75%', height: 22 }]} />
    </Animated.View>
  );
}

const s = StyleSheet.create({
  card: { width: CARD_WIDTH, padding: 16, borderRadius: radius.card, backgroundColor: light.surface, borderWidth: 1.5, borderColor: light.border, marginRight: 12, gap: 12 },
  selected: { borderColor: light.go, backgroundColor: light.goSoft },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 48, height: 48, borderRadius: 14, backgroundColor: light.routeSoft, alignItems: 'center', justifyContent: 'center' },
  name: { color: light.text, fontFamily: font.bold, fontSize: 16 },
  meta: { color: light.textMuted, fontFamily: font.medium, fontSize: 13, marginTop: 2 },
  price: { color: light.text, fontFamily: font.bold, fontSize: 22, letterSpacing: -0.3 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  bar: { height: 14, borderRadius: 7, backgroundColor: light.surfaceRaised },
});
