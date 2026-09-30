export const colors = {
  bg: '#090D16',
  surface: '#0F172A',
  surfaceRaised: '#1E293B',
  border: 'rgba(148,163,184,0.18)',
  text: '#F8FAFC',
  textMuted: '#94A3B8',
  go: '#00E676',      // primary actions
  route: '#38BDF8',   // route line, selection
  warn: '#FBBF24',
  danger: '#F43F5E',
};

export const radius = { sheet: 24, card: 20, pill: 999 };

// Plus Jakarta Sans via @expo-google-fonts/plus-jakarta-sans
export const font = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
};

export const zar = (n: number) => `R ${Math.round(n).toLocaleString('en-ZA').replace(/\u00a0/g, ' ')}`;
export const zarRange = (a: number, b: number) => `${zar(a)} – ${zar(b)}`;

export const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#0F172A' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#64748B' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0F172A' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1E293B' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#334155' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#090D16' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];
