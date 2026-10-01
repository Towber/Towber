import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, darkMapStyle, font, radius, zarRange } from '../theme';
import { createRequest, fetchNearby, LatLng, roadKm, subscribeRequestDriverLocation, Truck } from '../api';
import { SearchBar } from '../components/SearchBar';
import { TruckCard, TruckCardSkeleton, CARD_WIDTH } from '../components/TruckCard';
import { TruckMarker } from '../components/TruckMarker';

// Johannesburg CBD fallback if location permission is denied
const FALLBACK: LatLng = { lat: -26.2041, lng: 28.0473 };
const DEFAULT_TRIP_KM = 10;

type TrackingState = 'idle' | 'connecting' | 'connected' | 'error';

const Glass = ({ style }: { style?: any }) => (
  <View style={[style, { overflow: 'hidden', borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet }]}>
    <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
    <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(15,23,42,0.74)' }]} />
  </View>
);

export default function HomeScreen() {
  const { bottom } = useSafeAreaInsets();
  const map = useRef<MapView>(null);
  const [me, setMe] = useState<LatLng | null>(null);
  const [dest, setDest] = useState<LatLng | null>(null);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [trackingState, setTrackingState] = useState<TrackingState>('idle');

  const tripKm = useMemo(() => (me && dest ? roadKm(me, dest) : DEFAULT_TRIP_KM), [me, dest]);
  const selected = trucks.find((t) => t.vehicleId === selectedId) ?? null;

  // 1) Get the motorist's position
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return setMe(FALLBACK);
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setMe({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    })().catch(() => setMe(FALLBACK));
  }, []);

  // 2) Load nearby trucks + dynamic ZAR quotes, refresh every 30s.
  const load = useCallback(async () => {
    if (!me) return;
    try {
      setTrucks(await fetchNearby(me, tripKm));
    } catch (e: any) {
      Alert.alert('Could not load tow trucks', e.message ?? 'Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [me, tripKm]);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  // 3) Subscribe only to the active request's private topic; never stream the whole fleet.
  useEffect(() => {
    if (!activeRequestId) {
      setTrackingState('idle');
      return;
    }

    let mounted = true;
    let unsubscribe: (() => void) | undefined;
    setTrackingState('connecting');
    subscribeRequestDriverLocation(
      activeRequestId,
      (location) => {
        setTrucks((previous) => previous.map((truck) => (
          truck.vehicleId === location.vehicleId
            ? { ...truck, lat: location.lat, lng: location.lng }
            : truck
        )));
      },
      (status) => {
        if (mounted) setTrackingState(status);
      },
    )
      .then((stop) => {
        if (mounted) unsubscribe = stop;
        else stop();
      })
      .catch(() => { if (mounted) setTrackingState('error'); });

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [activeRequestId]);

  // Frame the map when we know where the user is / where they're going.
  useEffect(() => {
    if (!me) return;
    const pts = dest ? [me, dest] : [me];
    if (pts.length === 1) {
      map.current?.animateToRegion({ latitude: me.lat, longitude: me.lng, latitudeDelta: 0.06, longitudeDelta: 0.06 }, 600);
    } else {
      map.current?.fitToCoordinates(pts.map((p) => ({ latitude: p.lat, longitude: p.lng })), {
        edgePadding: { top: 220, bottom: 380, left: 60, right: 60 }, animated: true,
      });
    }
  }, [me, dest]);

  const searchDestination = async (query: string) => {
    setSearching(true);
    try {
      const hits = await Location.geocodeAsync(`${query}, South Africa`);
      if (!hits.length) return Alert.alert('No match', 'Try a street name, suburb or landmark.');
      setDest({ lat: hits[0].latitude, lng: hits[0].longitude });
      Haptics.selectionAsync();
    } finally {
      setSearching(false);
    }
  };

  const pick = (t: Truck) => {
    if (activeRequestId) return;
    Haptics.selectionAsync();
    setSelectedId(t.vehicleId);
  };

  const request = async () => {
    if (!me || !dest || !selected || activeRequestId) return;
    setRequesting(true);
    try {
      const { request: created } = await createRequest({ pickup: me, dropoff: dest, vehicleId: selected.vehicleId, tripDistanceKm: tripKm });
      setActiveRequestId(created.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Request sent',
        `${selected.companyName} has been notified. Reference ${created.id.slice(0, 8)}. Driver GPS updates will appear here when the driver comes online.`,
      );
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Request failed', e.message);
    } finally {
      setRequesting(false);
    }
  };

  const needsDest = !dest;
  const trackingCopy: Record<Exclude<TrackingState, 'idle'>, string> = {
    connecting: 'Connecting to private driver tracking…',
    connected: 'Private tracking connected · waiting for a GPS update',
    error: 'Tracking connection interrupted · reconnecting',
  };

  return (
    <View style={s.root}>
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_GOOGLE}
        customMapStyle={darkMapStyle}
        userInterfaceStyle="dark"
        showsUserLocation
        showsMyLocationButton={false}
        toolbarEnabled={false}
        initialRegion={{ latitude: FALLBACK.lat, longitude: FALLBACK.lng, latitudeDelta: 0.2, longitudeDelta: 0.2 }}
      >
        {me && dest && (
          <Polyline
            coordinates={[{ latitude: me.lat, longitude: me.lng }, { latitude: dest.lat, longitude: dest.lng }]}
            strokeColor={colors.route} strokeWidth={4} lineDashPattern={[1]}
          />
        )}
        {dest && <Marker coordinate={{ latitude: dest.lat, longitude: dest.lng }} pinColor={colors.route} />}
        {trucks.map((t) => (
          <TruckMarker key={t.vehicleId} truck={t} selected={t.vehicleId === selectedId} onPress={() => pick(t)} />
        ))}
      </MapView>

      <SearchBar pickupLabel={me ? 'Your location' : 'Finding you…'} busy={searching} onSubmit={searchDestination} />

      {/* Emergency: 112 works from any SA mobile network */}
      <Pressable
        onPress={() => Linking.openURL('tel:112')}
        accessibilityRole="button" accessibilityLabel="Call emergency services, 112"
        style={s.sos}
      >
        <Ionicons name="call" size={18} color={colors.text} />
        <Text style={s.sosText}>SOS</Text>
      </Pressable>

      <BottomSheet snapPoints={[230, '55%']} index={0} backgroundComponent={Glass} handleIndicatorStyle={{ backgroundColor: colors.textMuted, width: 40 }}>
        <BottomSheetView style={s.sheet}>
          <View style={s.head}>
            <Text style={s.title}>{activeRequestId ? 'Your tow request' : 'Nearby tow trucks'}</Text>
            {!loading && <Text style={s.count}>{trucks.length} available</Text>}
          </View>
          {activeRequestId && <Text style={s.tracking}>{trackingCopy[trackingState === 'idle' ? 'connecting' : trackingState]}</Text>}

          {loading ? (
            <View style={{ flexDirection: 'row', paddingHorizontal: 16 }}><TruckCardSkeleton /><TruckCardSkeleton /></View>
          ) : trucks.length === 0 ? (
            <Text style={s.empty}>No verified trucks within 15 km right now. Try again in a minute or call your insurer’s roadside line.</Text>
          ) : (
            <FlatList
              horizontal showsHorizontalScrollIndicator={false}
              data={trucks} keyExtractor={(t) => t.vehicleId}
              contentContainerStyle={{ paddingHorizontal: 16 }}
              snapToInterval={CARD_WIDTH + 12} decelerationRate="fast"
              renderItem={({ item }) => <TruckCard truck={item} selected={item.vehicleId === selectedId} onPress={() => pick(item)} />}
            />
          )}

          <Pressable
            onPress={request}
            disabled={!selected || needsDest || requesting || !!activeRequestId}
            accessibilityRole="button"
            style={[s.cta, (!selected || needsDest || requesting || !!activeRequestId) && s.ctaOff, { marginBottom: bottom + 8 }]}
          >
            <Text style={s.ctaText}>
              {activeRequestId ? 'Tow requested · tracking this driver'
                : needsDest ? 'Enter a destination for your price'
                : !selected ? 'Choose a truck'
                : requesting ? 'Sending request…'
                : `Request ${selected.companyName}  ·  ${zarRange(selected.priceMin, selected.priceMax)}`}
            </Text>
          </Pressable>
        </BottomSheetView>
      </BottomSheet>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  sheet: { gap: 14, paddingBottom: 8 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: 20 },
  title: { color: colors.text, fontFamily: font.bold, fontSize: 18 },
  count: { color: colors.textMuted, fontFamily: font.medium, fontSize: 13 },
  tracking: { color: colors.route, fontFamily: font.medium, fontSize: 12, paddingHorizontal: 20 },
  empty: { color: colors.textMuted, fontFamily: font.medium, fontSize: 14, paddingHorizontal: 20, lineHeight: 20 },
  cta: { marginHorizontal: 16, height: 54, borderRadius: 16, backgroundColor: colors.go, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  ctaOff: { backgroundColor: colors.surfaceRaised },
  ctaText: { color: colors.bg, fontFamily: font.bold, fontSize: 15 },
  sos: { position: 'absolute', right: 16, top: '34%', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.danger, paddingHorizontal: 14, height: 40, borderRadius: radius.pill },
  sosText: { color: colors.text, fontFamily: font.bold, fontSize: 13 },
});
