import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { VehicleType } from '../api';

const icons: Record<VehicleType, keyof typeof MaterialCommunityIcons.glyphMap> = {
  flatbed: 'truck-flatbed',
  standard: 'tow-truck',
  heavy_recovery: 'truck-cargo-container',
};
export const typeLabel: Record<VehicleType, string> = {
  flatbed: 'Flatbed', standard: 'Standard tow', heavy_recovery: 'Heavy recovery',
};

export const TruckIcon = ({ type, size = 24, color }: { type: VehicleType; size?: number; color: string }) => (
  <MaterialCommunityIcons name={icons[type] ?? 'tow-truck'} size={size} color={color} />
);
