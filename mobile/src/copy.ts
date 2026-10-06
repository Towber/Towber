// One place for the brand name of the people who fulfil requests. Towber hosts
// several services (towing, jump starts, fuel, tyres, ...), and the people who
// do the work are called TowberPros (previously "partners"). Internal identifiers
// (the `driver` DB role, the /(main)/driver route, API paths, `partner_*` tables)
// are intentionally unchanged.
export const BRAND = {
  name: 'Towber',
  tagline: 'Fast Roadside & Towing.',
};

export const TOWBERPRO = {
  singular: 'TowberPro',
  Singular: 'TowberPro',
  plural: 'TowberPros',
  Plural: 'TowberPros',
  portal: 'TowberPro portal',
  portalTag: 'TOWBERPRO PORTAL',
  mode: 'TOWBERPRO MODE',
};

// Kept so older imports keep working.
export const PARTNER = TOWBERPRO;

export type ProKind = 'towing' | 'mobile_tech';

// Profile badge: derived from the services a TowberPro selected.
// Towing & recovery => "TowberPro (Towing)", anything else => "TowberPro (Mobile Tech)".
export const proBadge = (kind: ProKind) =>
  kind === 'towing' ? 'TowberPro (Towing)' : 'TowberPro (Mobile Tech)';

export const proKindFromCapabilities = (capabilities: readonly string[]): ProKind =>
  capabilities.includes('flatbed') ? 'towing' : 'mobile_tech';
