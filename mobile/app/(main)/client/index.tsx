import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, darkMapStyle, font, radius, zarRange } from '../../../src/theme';
import { supabase, type BreakdownType, createRequest, fetchNearby, fetchPlaceSuggestions, fetchRoadRoute, type LatLng, type PlaceSuggestion, type RoadRoute, roadKm, subscribeRequestDriverLocation, type Truck } from '../../../src/api';
import { SearchBar } from '../../../src/components/SearchBar';
import { TruckCard, TruckCardSkeleton, CARD_WIDTH } from '../../../src/components/TruckCard';
import { TruckMarker } from '../../../src/components/TruckMarker';

// Johannesburg CBD fallback if location permission is denied
const FALLBACK: LatLng = { lat: -26.2041, lng: 28.0473 };
const DEFAULT_TRIP_KM = 10;
const newPlacesSessionToken = () => `towber-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const BREAKDOWN_SERVICES: { id: BreakdownType; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { id: 'flatbed', label: 'Flatbed', icon: 'car-outline' },
  { id: 'jumpstart', label: 'Jumpstart', icon: 'flash-outline' },
  { id: 'lockout', label: 'Lockout', icon: 'key-outline' },
];

type TrackingState = 'idle' | 'connecting' | 'connected' | 'error';

const Glass = ({ style }: { style?: any }) => (
  <View style={[style, { overflow: 'hidden', borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet }]}>
    <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
    <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(15,23,42,0.74)' }]} />
  </View>
);

export default function HomeScreen() {
  const { bottom, top } = useSafeAreaInsets();
  const map = useRef<MapView>(null);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [me, setMe] = useState<LatLng | null>(null);
  const [dest, setDest] = useState<LatLng | null>(null);
  const [route, setRoute] = useState<RoadRoute | null>(null);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [quoteDistanceKm, setQuoteDistanceKm] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [placeSuggestions, setPlaceSuggestions] = useState<PlaceSuggestion[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const placesSessionToken = useRef(newPlacesSessionToken());
  const [requesting, setRequesting] = useState(false);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [trackingState, setTrackingState] = useState<TrackingState>('idle');
  const [breakdownType, setBreakdownType] = useState<BreakdownType>('flatbed');

  const tripKm = useMemo(() => route?.distanceKm ?? (me && dest ? roadKm(me, dest) : DEFAULT_TRIP_KM), [me, dest, route]);
  const selected = trucks.find((t) => t.vehicleId === selectedId) ?? null;

  const switchAccount = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) Alert.alert('Could not sign out', error.message);
  };

// Ask for permission when the client route mounts; the resulting GPS fix is
// used both to center the map and as the pickup sent with a tow request.
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return setMe(FALLBACK);
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setMe({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    })().catch(() => setMe(FALLBACK));
  }, []);

  // Debounced Places (New) search, biased toward the motorist and restricted to South Africa.
  useEffect(() => {
    const query = searchQuery.trim();
    if (!me || query.length < 3 || dest) {
      setPlaceSuggestions([]);
      setSuggesting(false);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      setSuggesting(true);
      fetchPlaceSuggestions(query, me, placesSessionToken.current)
        .then((suggestions) => {
          if (current) {
            setPlaceSuggestions(suggestions);
            setSearchError(null);
          }
        })
        .catch((error: unknown) => {
          if (current) {
            setPlaceSuggestions([]);
            setSearchError(error instanceof Error ? error.message : 'Address search is unavailable. Try again.');
          }
        })
        .finally(() => { if (current) setSuggesting(false); });
    }, 350);
    return () => { current = false; clearTimeout(timer); };
  }, [searchQuery, me, dest]);

  // 2) Load nearby trucks + dynamic ZAR quotes, refresh every 30s.
  const load = useCallback(async () => {
    if (!me) return;
    try {
      setTrucks(await fetchNearby(me, tripKm));
      setQuoteDistanceKm(tripKm);
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

  const changeDestinationQuery = (query: string) => {
    setSearchQuery(query);
    setDest(null);
    setRoute(null);
    setSearchError(null);
    setPlaceSuggestions([]);
  };

  const selectDestination = async (suggestion: PlaceSuggestion) => {
    if (!me) return;
    setPlaceSuggestions([]);
    setSearchQuery('');
    setSearchError(null);
    setSearching(true);
    const selectedSessionToken = placesSessionToken.current;
    placesSessionToken.current = newPlacesSessionToken();
    try {
      const drivingRoute = await fetchRoadRoute(me, suggestion.placeId, selectedSessionToken);
      if (drivingRoute.coordinates.length < 2) throw new Error('No road route was returned. Choose another destination.');
      setRoute(drivingRoute);
      setDest(drivingRoute.destination);
      Haptics.selectionAsync();
    } catch (error: unknown) {
      setDest(null);
      setRoute(null);
      setSearchError(error instanceof Error ? error.message : 'Could not build a driving route. Try another destination.');
    } finally {
      setSearching(false);
    }
  };

  const pick = (t: Truck) => {
    if (activeRequestId) return;
    Haptics.selectionAsync();
    setSelectedId(t.vehicleId);
  };

  // Request Tow is sent through the authenticated backend API, which writes to
  // public.tow_requests and converts {lat, lng} into the PostGIS pickup point.
  const request = async () => {
    if (!me || !dest || !selected || activeRequestId) return;
    setRequesting(true);
    try {
      const { request: created } = await createRequest({ pickup: me, dropoff: dest, vehicleId: selected.vehicleId, tripDistanceKm: tripKm, breakdownType });
      setActiveRequestId(created.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Request sent',
        `${selected.companyName} has been notified for ${BREAKDOWN_SERVICES.find((service) => service.id === breakdownType)?.label}. Reference ${created.id.slice(0, 8)}. Driver GPS updates will appear here when the driver comes online.`,
      );
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Request failed', e.message);
    } finally {
      setRequesting(false);
    }
  };

  const needsDest = !dest;
  const quoteRefreshing = quoteDistanceKm !== tripKm;
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
        customMapStyle={isDarkMode ? darkMapStyle : []}
        userInterfaceStyle={isDarkMode ? 'dark' : 'light'}
        showsUserLocation
        showsMyLocationButton={false}
        toolbarEnabled={false}
        initialRegion={{ latitude: FALLBACK.lat, longitude: FALLBACK.lng, latitudeDelta: 0.2, longitudeDelta: 0.2 }}
      >
        {route && route.coordinates.length > 1 && (
          <Polyline
            coordinates={route.coordinates.map((point) => ({ latitude: point.lat, longitude: point.lng }))}
            strokeColor={colors.route} strokeWidth={5}
          />
        )}
        {dest && <Marker coordinate={{ latitude: dest.lat, longitude: dest.lng }} pinColor={colors.route} />}
        {trucks.map((t) => (
          <TruckMarker key={t.vehicleId} truck={t} selected={t.vehicleId === selectedId} onPress={() => pick(t)} />
        ))}
      </MapView>

      <SearchBar
        pickupLabel={me ? 'Your location' : 'Finding you…'}
        busy={searching || suggesting}
        suggestions={placeSuggestions}
        searchError={searchError}
        routeSummary={route ? `${route.distanceKm.toFixed(1)} km · ${route.durationMinutes ? `about ${route.durationMinutes} min` : 'ETA unavailable'}` : null}
        onQueryChange={changeDestinationQuery}
        onSubmit={setSearchQuery}
        onSelect={selectDestination}
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Switch to ${isDarkMode ? 'light' : 'dark'} map mode`}
        onPress={() => setIsDarkMode((value) => !value)}
        style={[s.themeToggle, { top: top + 154 }]}
        hitSlop={6}
      >
        <Ionicons name={isDarkMode ? 'sunny-outline' : 'moon-outline'} size={17} color={colors.text} />
        <Text style={s.themeToggleText}>{isDarkMode ? 'Light' : 'Dark'}</Text>
      </Pressable>

      {/* Emergency: 112 works from any SA mobile network */}
      <Pressable
        onPress={() => Linking.openURL('tel:112')}
        accessibilityRole="button" accessibilityLabel="Call emergency services, 112"
        style={s.sos}
      >
        <Ionicons name="call" size={18} color={colors.text} />
        <Text style={s.sosText}>SOS</Text>
      </Pressable>

      <BottomSheet snapPoints={[310, '66%']} index={0} backgroundComponent={Glass} handleIndicatorStyle={{ backgroundColor: colors.textMuted, width: 40 }}>
        <BottomSheetView style={s.sheet}>
          <View style={s.head}>
            <Text style={s.title}>{activeRequestId ? 'Your tow request' : 'Nearby tow trucks'}</Text>
            {!loading && <Text style={s.count}>{trucks.length} available</Text>}
          </View>
          <View style={s.serviceSection}>
            <Text style={s.servicePrompt}>Breakdown service</Text>
            <View style={s.serviceRow}>
              {BREAKDOWN_SERVICES.map((service) => {
                const selectedService = breakdownType === service.id;
                return (
                  <Pressable
                    key={service.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: selectedService }}
                    onPress={() => setBreakdownType(service.id)}
                    style={[s.serviceChoice, selectedService && s.serviceChoiceSelected]}
                  >
                    <Ionicons name={service.icon} size={17} color={selectedService ? colors.go : colors.textMuted} />
                    <Text style={[s.serviceName, selectedService && { color: colors.text }]} numberOfLines={1}>{service.label}</Text>
                  </Pressable>
                );
              })}
            </View>
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

          <View style={[s.bottomControls, { marginBottom: bottom + 8 }]}>
            <Pressable
              onPress={request}
              disabled={!selected || needsDest || quoteRefreshing || requesting || !!activeRequestId}
              accessibilityRole="button"
              style={[s.cta, (!selected || needsDest || requesting || !!activeRequestId) && s.ctaOff]}
            >
              <Text style={s.ctaText}>
                {activeRequestId ? 'Tow requested · tracking this driver'
                  : needsDest ? 'Enter a destination for your price'
                  : !selected ? 'Choose a truck'
                  : quoteRefreshing ? 'Updating route-based ZAR estimate…'
                  : requesting ? 'Sending request…'
                  : `Request Tow  ·  ${zarRange(selected.priceMin, selected.priceMax)}`}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Log out"
              onPress={() => { void switchAccount(); }}
              style={s.logoutButton}
              hitSlop={6}
            >
              <Ionicons name="log-out-outline" size={19} color={colors.text} />
              <Text style={s.logoutText}>Log Out</Text>
            </Pressable>
          </View>
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
  serviceSection: { gap: 8 },
  servicePrompt: { color: colors.textMuted, fontFamily: font.medium, fontSize: 12, paddingHorizontal: 20 },
  serviceRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  serviceChoice: { flex: 1, minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: 'rgba(30,41,59,0.6)', paddingHorizontal: 6 },
  serviceChoiceSelected: { borderColor: colors.go, backgroundColor: 'rgba(0,230,118,0.10)' },
  serviceName: { color: colors.textMuted, fontFamily: font.semibold, fontSize: 12 },
  tracking: { color: colors.route, fontFamily: font.medium, fontSize: 12, paddingHorizontal: 20 },
  empty: { color: colors.textMuted, fontFamily: font.medium, fontSize: 14, paddingHorizontal: 20, lineHeight: 20 },
  themeToggle: { position: 'absolute', right: 16, minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: 'rgba(15,23,42,0.9)', borderWidth: 1, borderColor: colors.border },
  themeToggleText: { color: colors.text, fontFamily: font.semibold, fontSize: 12 },
  bottomControls: { flexDirection: 'row', alignItems: 'stretch', gap: 10, paddingHorizontal: 16 },
  cta: { flex: 1, height: 54, borderRadius: 16, backgroundColor: colors.go, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  ctaOff: { backgroundColor: colors.surfaceRaised },
  ctaText: { color: colors.bg, fontFamily: font.bold, fontSize: 15 },
  logoutButton: { minWidth: 92, minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 16, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12 },
  logoutText: { color: colors.text, fontFamily: font.bold, fontSize: 12 },
  sos: { position: 'absolute', right: 16, top: '34%', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.danger, paddingHorizontal: 14, height: 40, borderRadius: radius.pill },
  sosText: { color: colors.text, fontFamily: font.bold, fontSize: 13 },
});
