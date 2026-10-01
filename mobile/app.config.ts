import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Towber',
  slug: 'towber-ralph',
  scheme: 'towber',
  version: '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'dark',
  runtimeVersion: { policy: 'fingerprint' },
  updates: {
    url: 'https://u.expo.dev/3825fcde-0fa5-4f65-b3f6-e0aa5edae8d2',
    checkAutomatically: 'ON_LOAD',
    fallbackToCacheTimeout: 0,
  },
  ios: {
    bundleIdentifier: 'com.towber.motorist',
    supportsTablet: true,
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        'Towber uses your location to find nearby tow trucks and set your pickup point.',
    },
  },
  android: {
    package: 'com.towber.motorist',
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'],
    config: {
      googleMaps: {
        apiKey: 'AIzaSyCByytkUXWtJy9gTa5O4z8AmFOgwxQT43g',
      },
    },
  },
  plugins: [
    'expo-router',
    'expo-font',
    'expo-updates',
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Allow Towber to use your location to find nearby tow trucks and set your pickup point.',
      },
    ],
    [
      'react-native-maps',
      {
        androidGoogleMapsApiKey: 'AIzaSyCByytkUXWtJy9gTa5O4z8AmFOgwxQT43g',
        iosGoogleMapsApiKey: process.env.GOOGLE_MAPS_IOS_API_KEY,
      },
    ],
  ],
  extra: {
    eas: {
      projectId: '3825fcde-0fa5-4f65-b3f6-e0aa5edae8d2',
    },
  },
};

export default config;
