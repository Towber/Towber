import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ActivityIndicator, FlatList, Linking, Modal, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { useRouter } from 'expo-router';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { darkMapStyle, font, light as L, radius, zar, zarRange } from '../../../src/theme';
import { supabase, type BreakdownType, createRequest, fetchActiveRequest, fetchNearby, fetchPlaceSuggestions, fetchRoadRoute, getRequest, isActiveRequestStatus, isTerminalRequestStatus, transitionRequest, type LatLng, type PlaceSuggestion, type RoadRoute, roadKm, subscribeRequestDriverLocation, type RequestStatus, type Truck } from '../../../src/api';
import { SearchBar } from '../../../src/components/SearchBar';
import { TopBar, TOPBAR_HEIGHT } from '../../../src/components/TopBar';
import { TOW_TYPE_OPTIONS, getDraft, matchesTowType, serviceIcon, serviceLabel, type TowTypeFilter } from '../../../src/requestDraft';
import { TruckCard, TruckCardSkeleton, CARD_WIDTH } from '../../../src/components/TruckCard';
import { TruckMarker } from '../../../src/components/TruckMarker';
import { loadMyRating, submitRequestRating } from '../../../src/chat';

// Johannesburg CBD fallback if location permission is denied
const FALLBACK: LatLng = { lat: -26.2041, lng: 28.0473 };
const DEFAULT_TRIP_KM = 10;
const CALLOUT_ONLY_KM = 0.5; // non-towing jobs have no trip: quote the minimum distance
const newPlacesSessionToken = () => `towber-${Date.now()}-${Math.random().toString(36).slice(2)}`;
type TrackingState = 'idle' | 'connecting' | 'connected' | 'error';

const TIMELINE: { key: RequestStatus; label: string }[] = [
  { key: 'pending', label: 'Sent' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'en_route', label: 'En route' },
  { key: 'arrived', label: 'Arrived' },
  { key: 'completed', label: 'Done' },
];
const STATUS_TITLE: Record<RequestStatus, string> = {
  pending: 'Assigning a nearby TowberPro...',
  accepted: 'TowberPro found',
  en_route: 'Your TowberPro is on the way',
  arrived: 'Your TowberPro has arrived',
  completed: 'Tow complete',
  cancelled: 'Request cancelled',
  declined: 'No truck available',
  expired: 'No response from TowberPros',
};
const STATUS_COPY: Record<RequestStatus, string> = {
  pending: 'Nearby TowberPros have been notified of your breakdown.',
  accepted: 'Your TowberPro is arriving shortly.',
  en_route: 'Your TowberPro is arriving shortly. Live GPS tracking is on.',
  arrived: 'Your TowberPro is at your location.',
  completed: 'Thanks for riding with Towber. Safe travels.',
  cancelled: 'You cancelled this request. You can request a new tow anytime.',
  declined: 'Every nearby truck was unavailable. Try again or pick another truck.',
  expired: 'No TowberPro responded in time. Try again with the nearest trucks.',
};

// White Bolt-style bottom sheet.
const Sheet = ({ style }: { style?: any }) => (
  <View style={[style, { backgroundColor: L.surface, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, elevation: 16, shadowColor: '#000000', shadowOpacity: 0.16, shadowRadius: 14, shadowOffset: { width: 0, height: -4 } }]} />
);

export default function HomeScreen() {
  const router = useRouter();
  const { top, bottom } = useSafeAreaInsets();
  const map = useRef<MapView>(null);
  const sheetRef = useRef<BottomSheet>(null);
  const draft = useRef(getDraft()).current;
  const [me, setMe] = useState<LatLng | null>(null);
  const [pickupLabel, setPickupLabel] = useState('Your location');
  const [pickupSearchQuery, setPickupSearchQuery] = useState('');
  const [pickupEditing, setPickupEditing] = useState(false);
  const [searchMode, setSearchMode] = useState<'pickup' | 'destination'>('destination');
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
  const [requestStatus, setRequestStatus] = useState<RequestStatus | null>(null);
  const [requestExpiresAt, setRequestExpiresAt] = useState<string | null>(null);
  const [requestCompany, setRequestCompany] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [clockMs, setClockMs] = useState(() => Date.now());
  const [trackingState, setTrackingState] = useState<TrackingState>('idle');
  const breakdownType: BreakdownType = draft?.breakdownType ?? 'flatbed';
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [darkMapEnabled, setDarkMapEnabled] = useState(false);
  const [ratingVisible, setRatingVisible] = useState(false);
  const [ratingValue, setRatingValue] = useState(0);
  const [ratingComment, setRatingComment] = useState('');
  const [ratingSaved, setRatingSaved] = useState(false);
  const [ratingSaving, setRatingSaving] = useState(false);

  const [towType, setTowType] = useState<TowTypeFilter>(draft?.towType ?? 'any');
  const isTow = breakdownType === 'flatbed';
  const tripKm = useMemo(
    () => (!isTow ? CALLOUT_ONLY_KM : route?.distanceKm ?? (me && dest ? roadKm(me, dest) : DEFAULT_TRIP_KM)),
    [isTow, me, dest, route],
  );
  const visibleTrucks = useMemo(
    () => (isTow ? trucks.filter((t) => matchesTowType(t.vehicleType, towType)) : trucks),
    [trucks, isTow, towType],
  );
  const selected = visibleTrucks.find((t) => t.vehicleId === selectedId) ?? null;

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
    const query = (searchMode === 'pickup' ? pickupSearchQuery : searchQuery).trim();
    if (!me || searching || query.length < 3 || (searchMode === 'destination' && dest)) {
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
  }, [searchMode, pickupSearchQuery, searchQuery, me, dest, searching]);

  // 2) Load nearby trucks + dynamic ZAR quotes, refresh every 30s.
  const load = useCallback(async () => {
    if (!me) return;
    try {
      setTrucks(await fetchNearby(me, tripKm, breakdownType));
      setQuoteDistanceKm(tripKm);
    } catch (e: any) {
      Alert.alert('Could not load nearby TowberPros', e.message ?? 'Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [me, tripKm, breakdownType]);

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

  // Resume an already-open request after an app restart, so the status panel
  // survives navigation and redeploys.
  useEffect(() => {
    let mounted = true;
    fetchActiveRequest()
      .then((row) => {
        if (!mounted || !row) return;
        setActiveRequestId(row.id);
        setRequestStatus(row.status);
        setRequestExpiresAt(row.expires_at ?? null);
        setRequestCompany(row.towing_companies?.company_name ?? null);
      })
      .catch(() => { /* No active request, or offline — start fresh. */ });
    return () => { mounted = false; };
  }, []);

  // Poll the request's real status; stop once it reaches a terminal state.
  useEffect(() => {
    if (!activeRequestId) {
      setRequestStatus(null);
      setRequestExpiresAt(null);
      return;
    }
    const terminal = !!requestStatus && isTerminalRequestStatus(requestStatus);
    let stopped = false;
    const refresh = () => {
      getRequest(activeRequestId)
        .then((row) => {
          if (stopped) return;
          setRequestStatus(row.status);
          setRequestExpiresAt(row.expires_at ?? null);
          if (row.towing_companies?.company_name) setRequestCompany(row.towing_companies.company_name);
        })
        .catch(() => { /* Keep the last known status until the next tick. */ });
    };
    refresh();
    if (terminal) return () => { stopped = true; };
    const timer = setInterval(refresh, 3000);
    return () => { stopped = true; clearInterval(timer); };
  }, [activeRequestId, requestStatus]);

  useEffect(() => {
    if (requestStatus !== 'completed' || !activeRequestId) return;
    loadMyRating(activeRequestId).then((existing) => {
      if (!existing) return;
      setRatingValue(existing.rating);
      setRatingComment(existing.comment ?? '');
      setRatingSaved(true);
    }).catch(() => { /* Rating is optional and should not block the completed view. */ });
  }, [activeRequestId, requestStatus]);

  // Offer countdown while the request is still pending.
  useEffect(() => {
    if (!activeRequestId || requestStatus !== 'pending') return;
    setClockMs(Date.now());
    const timer = setInterval(() => setClockMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [activeRequestId, requestStatus]);

  // Narrow card until there is a destination (or a live request); then open up for trucks.
  useEffect(() => { sheetRef.current?.snapToIndex(dest || activeRequestId ? 1 : 0); }, [dest, activeRequestId]);

  // Frame the map when we know where the user is / where they're going.
  useEffect(() => {
    if (!me) return;
    const pts = dest ? [me, dest] : [me];
    if (pts.length === 1) {
      map.current?.animateToRegion({ latitude: me.lat, longitude: me.lng, latitudeDelta: 0.06, longitudeDelta: 0.06 }, 600);
    } else {
      map.current?.fitToCoordinates(pts.map((p) => ({ latitude: p.lat, longitude: p.lng })), {
        edgePadding: { top: 280, bottom: 380, left: 60, right: 60 }, animated: true,
      });
    }
  }, [me, dest]);

  const changeDestinationQuery = (query: string) => {
    setSearchMode('destination');
    setSearchQuery(query);
    setDest(null);
    setRoute(null);
    setSearchError(null);
    setPlaceSuggestions([]);
  };

  const selectPlace = async (suggestion: PlaceSuggestion) => {
    if (!me) return;
    const selectingPickup = searchMode === 'pickup';
    const previousQuery = searchQuery;
    if (!selectingPickup) setSearchQuery(suggestion.description);
    setPlaceSuggestions([]);
    setSearchError(null);
    setSearching(true);
    const selectedSessionToken = placesSessionToken.current;
    placesSessionToken.current = newPlacesSessionToken();
    try {
      const drivingRoute = await fetchRoadRoute(me, suggestion.placeId, selectedSessionToken);
      if (selectingPickup) {
        setMe(drivingRoute.destination);
        setPickupLabel(drivingRoute.address || suggestion.description);
        setPickupSearchQuery('');
        setPickupEditing(false);
        setSearchMode('destination');
        setSearchQuery('');
        setRoute(null);
        setDest(null);
        setSelectedId(null);
      } else {
        if (drivingRoute.coordinates.length < 2) throw new Error('No road route was returned. Choose another destination.');
        setSearchQuery(suggestion.description);
        setRoute(drivingRoute);
        setDest(drivingRoute.destination);
      }
      Haptics.selectionAsync();
    } catch (error: unknown) {
      if (!selectingPickup) {
        setSearchQuery(previousQuery);
        setDest(null);
        setRoute(null);
      }
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
    if (!me || (isTow && !dest) || !selected || activeRequestId) return;
    setRequesting(true);
    try {
      const { request: created } = await createRequest({ pickup: me, dropoff: isTow && dest ? dest : me, vehicleId: selected.vehicleId, tripDistanceKm: tripKm, breakdownType, serviceFor: draft?.serviceFor, contactName: draft?.contactName, contactPhone: draft?.contactPhone, vehicleMakeModel: draft?.vehicleMakeModel, vehicleColor: draft?.vehicleColor, vehicleRegistration: draft?.vehicleRegistration, passengers: draft?.passengers });
      setActiveRequestId(created.id);
      setRequestStatus(created.status);
      setRequestExpiresAt(created.expires_at ?? null);
      setRequestCompany(selected.companyName);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Request failed', e.message);
    } finally {
      setRequesting(false);
    }
  };

  // Cancelling is confirmed, then goes through the same state machine the
  // drivers use, so the server owns the race between cancel and accept.
  const cancelActiveRequest = () => {
    if (!activeRequestId || cancelling) return;
    Alert.alert('Cancel this tow request?', 'The assigned truck is released and you can request a new tow.', [
      { text: 'Keep request', style: 'cancel' },
      {
        text: 'Cancel request',
        style: 'destructive',
        onPress: () => {
          setCancelling(true);
          transitionRequest(activeRequestId, 'cancel')
            .then((row) => {
              setRequestStatus(row.status);
              setRequestExpiresAt(row.expires_at ?? null);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            })
            .catch((error: unknown) => {
              Alert.alert('Could not cancel', error instanceof Error ? error.message : 'Try again.');
            })
            .finally(() => setCancelling(false));
        },
      },
    ]);
  };

  const resetRequest = () => {
    setActiveRequestId(null);
    setRequestStatus(null);
    setRequestExpiresAt(null);
    setRequestCompany(null);
    setRatingVisible(false);
    setRatingValue(0);
    setRatingComment('');
    setRatingSaved(false);
  };

  const callEmergencyServices = () => {
    setDrawerVisible(false);
    void Linking.openURL('tel:112').catch(() => Alert.alert('Unable to place call', 'Call emergency services at 112.'));
  };

  const saveRating = async () => {
    if (!activeRequestId || ratingValue < 1 || ratingSaving || ratingSaved) return;
    setRatingSaving(true);
    try {
      await submitRequestRating(activeRequestId, ratingValue, ratingComment);
      setRatingSaved(true);
      setRatingVisible(false);
    } catch (error) {
      Alert.alert('Could not save rating', error instanceof Error ? error.message : 'Please try again.');
    } finally { setRatingSaving(false); }
  };

  const expanded = !isTow || !!dest || !!activeRequestId;
  const needsDest = isTow && !dest;
  const quoteRefreshing = quoteDistanceKm !== tripKm;
  const ctaDisabled = !selected || needsDest || requesting;
  const trackingCopy: Record<Exclude<TrackingState, 'idle'>, string> = {
    connecting: 'Connecting to private live tracking…',
    connected: 'Private tracking connected · waiting for a GPS update',
    error: 'Tracking connection interrupted · reconnecting',
  };
  const activeStatus = !!requestStatus && isActiveRequestStatus(requestStatus);
  const timelineIndex = requestStatus ? TIMELINE.findIndex((step) => step.key === requestStatus) : -1;
  const pendingSecondsLeft = requestStatus === 'pending' && requestExpiresAt
    ? Math.max(0, Math.ceil((new Date(requestExpiresAt).getTime() - clockMs) / 1000))
    : 0;

  return (
    <View style={s.root}>
      <StatusBar style="light" />
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_GOOGLE}
        customMapStyle={darkMapEnabled ? darkMapStyle : []}
        userInterfaceStyle={darkMapEnabled ? 'dark' : 'light'}
        showsUserLocation
        showsMyLocationButton={false}
        toolbarEnabled={false}
        initialRegion={{ latitude: FALLBACK.lat, longitude: FALLBACK.lng, latitudeDelta: 0.2, longitudeDelta: 0.2 }}
      >
        {route && route.coordinates.length > 1 && (
          <Polyline
            coordinates={route.coordinates.map((point) => ({ latitude: point.lat, longitude: point.lng }))}
            strokeColor={L.route} strokeWidth={5}
          />
        )}
        {dest && <Marker coordinate={{ latitude: dest.lat, longitude: dest.lng }} pinColor={L.route} />}
        {visibleTrucks.map((t) => (
          <TruckMarker key={t.vehicleId} truck={t} selected={t.vehicleId === selectedId} onPress={() => pick(t)} />
        ))}
      </MapView>

      <SearchBar
        showDestination={isTow}
        pickupLabel={me ? pickupLabel : 'Finding you…'}
        pickupValue={pickupSearchQuery}
        pickupEditing={pickupEditing}
        activeSearch={searchMode}
        busy={searching || suggesting}
        suggestions={placeSuggestions}
        searchError={searchError}
        routeSummary={route ? `${route.distanceKm.toFixed(1)} km · ${route.durationMinutes ? `about ${route.durationMinutes} min` : 'ETA unavailable'}` : null}
        onPickupFocus={() => {
          setSearchMode('pickup');
          if (!pickupEditing) {
            setPickupEditing(true);
            setPickupSearchQuery('');
            setPlaceSuggestions([]);
          }
          setSearchError(null);
        }}
        onPickupQueryChange={(query) => {
          setSearchMode('pickup');
          setPickupEditing(true);
          setPickupSearchQuery(query);
          setSearchError(null);
        }}
        destinationValue={searchQuery}
        onClearPickup={() => { setSearchMode('pickup'); setPickupEditing(true); setPickupSearchQuery(''); setPlaceSuggestions([]); setSearchError(null); }}
        onClearDestination={() => changeDestinationQuery('')}
        onDestinationFocus={() => setSearchMode('destination')}
        onQueryChange={changeDestinationQuery}
        onSubmit={setSearchQuery}
        onSelect={selectPlace}
      />

      <TopBar onMenu={() => setDrawerVisible(true)} onSos={callEmergencyServices} />

      <Modal visible={drawerVisible} animationType="fade" statusBarTranslucent onRequestClose={() => setDrawerVisible(false)}>
        <View style={s.menuRoot}>
          <StatusBar style="light" />
          <View style={[s.menuBar, { paddingTop: top, height: top + TOPBAR_HEIGHT }]}>
            <Text style={s.menuBrand}>Towber</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close menu" onPress={() => setDrawerVisible(false)} hitSlop={10} style={s.menuClose}>
              <Ionicons name="close" size={30} color={L.onHeader} />
            </Pressable>
          </View>

          <View style={[s.menuBody, { paddingBottom: bottom + 20 }]}>
            <Pressable accessibilityRole="button" accessibilityLabel="Call emergency services, 112" onPress={callEmergencyServices} style={s.menuRow}>
              <View style={{ flex: 1 }}>
                <Text style={[s.menuTitle, { color: L.danger }]}>Emergency SOS</Text>
                <Text style={s.menuSub}>Call emergency services · 112</Text>
              </View>
              <Ionicons name="call" size={22} color={L.danger} />
            </Pressable>

            <View style={s.menuRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.menuTitle}>Map appearance</Text>
                <Text style={s.menuSub}>{darkMapEnabled ? 'Dark map' : 'Light map'}</Text>
              </View>
              <Switch
                accessibilityLabel="Toggle dark map"
                value={darkMapEnabled}
                onValueChange={setDarkMapEnabled}
                trackColor={{ false: '#D1D5DB', true: L.go }}
                thumbColor="#FFFFFF"
              />
            </View>
          </View>

        </View>
      </Modal>

      <BottomSheet ref={sheetRef} snapPoints={[192 + bottom, '62%']} index={expanded ? 1 : 0} backgroundComponent={Sheet} handleIndicatorStyle={{ backgroundColor: '#D1D5DB', width: 40 }}>
        <BottomSheetView style={s.sheet}>
          <View style={s.head}>
            <Text style={s.title}>{activeRequestId ? 'Your request' : !isTow ? 'Nearby help' : expanded ? 'Nearby TowberPros' : 'Where to?'}</Text>
            <View style={s.headActions}>
              {expanded && !loading && <Text style={s.count}>{visibleTrucks.length} available</Text>}
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Change service"
            disabled={!!activeRequestId}
            onPress={() => router.replace('/(main)/client')}
            style={s.serviceSummary}
          >
            <View style={s.summaryIcon}><MaterialCommunityIcons name={serviceIcon(breakdownType) as any} size={18} color={L.go} /></View>
            <Text style={s.summaryText} numberOfLines={1}>
              {serviceLabel(breakdownType)}{draft?.vehicleMakeModel ? ` · ${draft.vehicleMakeModel}` : ''}
            </Text>
            {!activeRequestId ? <Text style={s.summaryEdit}>Change</Text> : null}
          </Pressable>
          {isTow && !activeRequestId ? (
            <View style={s.towFilter}>
              {TOW_TYPE_OPTIONS.map((opt) => {
                const on = towType === opt.id;
                return (
                  <Pressable key={opt.id} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => { setTowType(opt.id); setSelectedId(null); }} style={[s.towFilterChip, on && s.towFilterChipOn]}>
                    <Text style={[s.towFilterText, on && { color: L.onGo }]}>{opt.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          {activeRequestId && activeStatus && requestStatus !== 'pending' && (
            <Text style={s.tracking}>{trackingCopy[trackingState === 'idle' ? 'connecting' : trackingState]}</Text>
          )}

          {!expanded ? null : loading ? (
            <View style={{ flexDirection: 'row', paddingHorizontal: 16 }}><TruckCardSkeleton /><TruckCardSkeleton /></View>
          ) : visibleTrucks.length === 0 ? (
            <Text style={s.empty}>{towType === 'any' || !isTow ? 'No verified TowberPros within 15 km right now.' : `No ${TOW_TYPE_OPTIONS.find((o) => o.id === towType)?.label} TowberPros within 15 km right now. Try "Any" to see every tow type.`} Try again in a minute or call your insurer’s roadside line.</Text>
          ) : (
            <FlatList
              horizontal showsHorizontalScrollIndicator={false}
              data={visibleTrucks} keyExtractor={(t) => t.vehicleId}
              contentContainerStyle={{ paddingHorizontal: 16 }}
              snapToInterval={CARD_WIDTH + 12} decelerationRate="fast"
              renderItem={({ item }) => <TruckCard truck={item} selected={item.vehicleId === selectedId} onPress={() => pick(item)} />}
            />
          )}

          {activeRequestId ? (
            <View style={[s.statusPanel, { marginBottom: bottom + 8 }]}>
              <Text style={s.statusTitle}>{requestStatus ? STATUS_TITLE[requestStatus] : 'Your request'}</Text>
              <Text style={s.statusSubtitle}>
                {requestStatus ? STATUS_COPY[requestStatus] : 'Checking the latest status…'}
              </Text>
              {requestCompany && activeStatus && requestStatus !== 'pending' && (
                <Text style={s.statusCompany}>{requestCompany}</Text>
              )}
              {timelineIndex >= 0 && (
                <View style={s.timeline}>
                  {TIMELINE.map((step, index) => {
                    const reached = index <= timelineIndex;
                    return (
                      <View key={step.key} style={[s.chip, reached && s.chipOn]}>
                        <Text style={[s.chipText, reached && s.chipTextOn]}>{step.label}</Text>
                      </View>
                    );
                  })}
                </View>
              )}
              {requestStatus === 'pending' && (
                <Text style={s.statusTimer}>
                  {pendingSecondsLeft > 0
                    ? `Offer window ${Math.floor(pendingSecondsLeft / 60)}:${String(pendingSecondsLeft % 60).padStart(2, '0')} · we re-dispatch if no one accepts`
                    : 'Re-dispatching to the next nearest truck…'}
                </Text>
              )}
              {activeStatus ? (
                <View style={s.statusActions}>
                  {requestStatus !== 'pending' ? <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/(main)/chat/[requestId]', params: { requestId: activeRequestId, peer: 'partner' } })} style={s.chatAction}><Ionicons name="chatbubble-ellipses-outline" size={18} color={L.text} /><Text style={s.chatActionText}>Chat with your TowberPro</Text></Pressable> : null}
                  <Pressable accessibilityRole="button" disabled={cancelling} onPress={cancelActiveRequest} style={[s.cancelButton, cancelling && s.cancelButtonOff]}>
                    {cancelling ? <ActivityIndicator size="small" color={L.danger} /> : <Text style={s.cancelText}>Cancel request</Text>}
                  </Pressable>
                </View>
              ) : (
                <View style={{ gap: 8 }}>
                  {requestStatus === 'completed' && !ratingSaved ? <Pressable accessibilityRole="button" onPress={() => setRatingVisible(true)} style={[s.cta, { marginHorizontal: 0 }]}><Text style={s.ctaText}>Rate your TowberPro</Text></Pressable> : null}
                  <Pressable accessibilityRole="button" onPress={resetRequest} style={[s.cta, { marginHorizontal: 0 }]}><Text style={s.ctaText}>{requestStatus === 'completed' ? (ratingSaved ? 'Done' : 'Skip for now') : 'Request help again'}</Text></Pressable>
                </View>
              )}
            </View>
          ) : (
            <Pressable
              onPress={request}
              disabled={!selected || needsDest || quoteRefreshing || requesting}
              accessibilityRole="button"
              style={[s.cta, ctaDisabled && s.ctaOff, { marginBottom: bottom + 8 }]}
            >
              <Text style={[s.ctaText, ctaDisabled && s.ctaTextOff]}>
                {needsDest ? 'Enter your destination for price'
                  : !selected ? 'Choose a TowberPro'
                  : quoteRefreshing ? 'Updating route-based ZAR estimate…'
                  : requesting ? 'Sending request…'
                  : `${isTow ? 'Request Tow' : `Request ${serviceLabel(breakdownType)}`}  ·  ${selected.pricingModel === 'flat' ? zar(selected.priceMin) : zarRange(selected.priceMin, selected.priceMax)}`}
              </Text>
            </Pressable>
          )}
        </BottomSheetView>
      </BottomSheet>

      <Modal visible={ratingVisible} transparent animationType="fade" onRequestClose={() => setRatingVisible(false)}>
        <View style={s.ratingBackdrop}>
          <View style={s.ratingCard}>
            <Text style={s.ratingEyebrow}>JOB COMPLETE</Text>
            <Text style={s.ratingTitle}>How was your TowberPro?</Text>
            <Text style={s.ratingBody}>Your feedback helps keep roadside help dependable for every guest.</Text>
            <View style={s.stars}>{[1, 2, 3, 4, 5].map((value) => <Pressable key={value} accessibilityRole="button" accessibilityLabel={`${value} star${value === 1 ? '' : 's'}`} onPress={() => setRatingValue(value)}><Ionicons name={value <= ratingValue ? 'star' : 'star-outline'} size={34} color={L.go} /></Pressable>)}</View>
            <TextInput accessibilityLabel="Rating comment" placeholder="Add a note (optional)" placeholderTextColor={L.disabledText} value={ratingComment} onChangeText={setRatingComment} style={s.ratingInput} multiline maxLength={500} />
            <Pressable accessibilityRole="button" disabled={!ratingValue || ratingSaving} onPress={() => { void saveRating(); }} style={[s.ratingSubmit, (!ratingValue || ratingSaving) && s.ctaOff]}>{ratingSaving ? <ActivityIndicator color={L.onGo} /> : <Text style={s.ctaText}>Submit rating</Text>}</Pressable>
            <Pressable accessibilityRole="button" onPress={() => setRatingVisible(false)} style={s.ratingCancel}><Text style={s.ratingCancelText}>Not now</Text></Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: L.bg },
  sheet: { gap: 14, paddingBottom: 8 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: 20 },
  headActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { color: L.text, fontFamily: font.bold, fontSize: 18 },
  towFilter: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  towFilterChip: { paddingHorizontal: 12, height: 34, borderRadius: 999, backgroundColor: L.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  towFilterChipOn: { backgroundColor: L.go },
  towFilterText: { color: L.text, fontFamily: font.medium, fontSize: 12 },
  count: { color: L.textMuted, fontFamily: font.medium, fontSize: 13 },
  serviceSummary: { marginHorizontal: 16, height: 44, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, borderRadius: 12, backgroundColor: L.surfaceRaised },
  summaryIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: L.goSoft, alignItems: 'center', justifyContent: 'center' },
  summaryText: { flex: 1, color: L.text, fontFamily: font.semibold, fontSize: 14 },
  summaryEdit: { color: L.go, fontFamily: font.bold, fontSize: 13 },
  statusPanel: { marginHorizontal: 16, gap: 8, padding: 16, borderRadius: 16, backgroundColor: L.surfaceRaised },
  statusTitle: { color: L.text, fontFamily: font.bold, fontSize: 16 },
  statusSubtitle: { color: L.textMuted, fontFamily: font.medium, fontSize: 13, lineHeight: 18 },
  statusCompany: { color: L.route, fontFamily: font.semibold, fontSize: 12 },
  timeline: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: L.border, backgroundColor: '#FFFFFF' },
  chipOn: { borderColor: L.go, backgroundColor: L.goSoft },
  chipText: { color: L.textMuted, fontFamily: font.semibold, fontSize: 11 },
  chipTextOn: { color: L.go },
  statusTimer: { color: L.warn, fontFamily: font.medium, fontSize: 12 },
  statusActions: { gap: 8 },
  chatAction: { height: 46, borderRadius: 14, borderWidth: 1, borderColor: L.border, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  chatActionText: { color: L.text, fontFamily: font.semibold, fontSize: 13 },
  cancelButton: { height: 46, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(220,38,38,0.5)', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  cancelButtonOff: { opacity: 0.6 },
  cancelText: { color: L.danger, fontFamily: font.semibold, fontSize: 14 },
  tracking: { color: L.route, fontFamily: font.medium, fontSize: 12, paddingHorizontal: 20 },
  empty: { color: L.textMuted, fontFamily: font.medium, fontSize: 14, paddingHorizontal: 20, lineHeight: 20 },
  cta: { marginHorizontal: 16, height: 54, borderRadius: 999, backgroundColor: L.go, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  ctaOff: { backgroundColor: L.disabled },
  ctaText: { color: L.onGo, fontFamily: font.bold, fontSize: 16 },
  ctaTextOff: { color: L.disabledText },
  ratingBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: 'rgba(17,24,39,0.55)' },
  ratingCard: { width: '100%', padding: 22, borderRadius: 26, backgroundColor: L.surface, gap: 10 },
  ratingEyebrow: { color: L.go, fontFamily: font.bold, fontSize: 11, letterSpacing: 1.3 },
  ratingTitle: { color: L.text, fontFamily: font.bold, fontSize: 23, letterSpacing: -0.4 },
  ratingBody: { color: L.textMuted, fontFamily: font.medium, fontSize: 13, lineHeight: 18 },
  stars: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingVertical: 8 },
  ratingInput: { minHeight: 80, borderRadius: 14, backgroundColor: L.surfaceRaised, padding: 12, color: L.text, fontFamily: font.medium, fontSize: 13, textAlignVertical: 'top' },
  ratingSubmit: { height: 52, borderRadius: 999, backgroundColor: L.go, alignItems: 'center', justifyContent: 'center' },
  ratingCancel: { height: 42, alignItems: 'center', justifyContent: 'center' },
  ratingCancelText: { color: L.textMuted, fontFamily: font.semibold, fontSize: 13 },
  // Uber-style full-screen menu
  menuRoot: { flex: 1, backgroundColor: '#FFFFFF' },
  menuBar: { backgroundColor: L.header, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  menuBrand: { color: L.onHeader, fontFamily: font.bold, fontSize: 28, letterSpacing: -0.8 },
  menuClose: { width: 32, height: 40, alignItems: 'center', justifyContent: 'center' },
  menuBody: { flex: 1, paddingHorizontal: 20, paddingTop: 12 },
  menuRow: { minHeight: 84, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: L.border },
  menuTitle: { color: L.text, fontFamily: font.bold, fontSize: 24, letterSpacing: -0.4 },
  menuSub: { color: L.textMuted, fontFamily: font.medium, fontSize: 14, marginTop: 3 },
  menuLogout: { marginHorizontal: 20, height: 54, borderRadius: 999, backgroundColor: '#EEEEEE', alignItems: 'center', justifyContent: 'center' },
  menuLogoutText: { color: L.text, fontFamily: font.bold, fontSize: 16 },
});
