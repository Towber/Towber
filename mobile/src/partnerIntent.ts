import AsyncStorage from '@react-native-async-storage/async-storage';

// Remembers that the person signed in from "Apply as a new partner", so the
// magic-link callback can send them to the application instead of the motorist home.
const KEY = 'towber.partnerApplyIntent';

export const setPartnerIntent = (on: boolean) =>
  (on ? AsyncStorage.setItem(KEY, '1') : AsyncStorage.removeItem(KEY)).catch(() => undefined);

export const hasPartnerIntent = () =>
  AsyncStorage.getItem(KEY).then((v) => v === '1').catch(() => false);
