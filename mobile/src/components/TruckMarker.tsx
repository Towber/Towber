import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { AnimatedRegion, MarkerAnimated } from 'react-native-maps';
import { light } from '../theme';
import type { Truck } from '../api';
import { TruckIcon } from './TruckIcon';

// Glides between GPS pings instead of jumping.
export function TruckMarker({ truck, selected, onPress }: { truck: Truck; selected: boolean; onPress: () => void }) {
  const coord = useRef(
    new AnimatedRegion({ latitude: truck.lat, longitude: truck.lng, latitudeDelta: 0, longitudeDelta: 0 }),
  ).current;

  useEffect(() => {
    (coord as any).timing({ latitude: truck.lat, longitude: truck.lng, duration: 900, useNativeDriver: false }).start();
  }, [truck.lat, truck.lng, coord]);

  return (
    <MarkerAnimated coordinate={coord as any} onPress={onPress} anchor={{ x: 0.5, y: 0.5 }}>
      <View style={[s.badge, selected && s.selected]}>
        <TruckIcon type={truck.vehicleType} size={selected ? 22 : 18} color={selected ? light.onGo : light.route} />
      </View>
    </MarkerAnimated>
  );
}

const s = StyleSheet.create({
  badge: { width: 38, height: 38, borderRadius: 19, backgroundColor: light.surface, borderWidth: 2, borderColor: light.route, alignItems: 'center', justifyContent: 'center' },
  selected: { backgroundColor: light.go, borderColor: light.go, transform: [{ scale: 1.15 }] },
});
