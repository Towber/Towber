import type { BreakdownType } from './api';

export type PartnerTier = 'tow_operator' | 'roadside_responder';
export type TowVehicleType = 'flatbed_rollback' | 'standard_tow' | 'heavy_duty' | 'winch_recovery';
export type ApplicationStatus = 'draft' | 'submitted' | 'needs_info' | 'approved' | 'rejected';
export type DocType =
  | 'id_document' | 'drivers_license' | 'prdp' | 'vehicle_license_disc'
  | 'certificate_of_fitness' | 'towing_insurance' | 'towing_permit'
  | 'trade_certificate' | 'vehicle_photo' | 'equipment_photo';

export const DOC_BUCKET = 'partner-documents-private';

export const TIERS: { id: PartnerTier; title: string; blurb: string; icon: string }[] = [
  { id: 'tow_operator', title: 'TowberPro (Towing)', blurb: 'You run a flatbed, winch bakkie, sling tow or other recovery vehicle.', icon: 'tow-truck' },
  { id: 'roadside_responder', title: 'TowberPro (Mobile Tech)', blurb: 'Mobile mechanic or technician in a bakkie or car.', icon: 'car-wrench' },
];

export const SERVICE_OPTIONS: { id: BreakdownType; label: string; icon: string }[] = [
  { id: 'flatbed', label: 'Towing & recovery', icon: 'tow-truck' },
  { id: 'jumpstart', label: 'Jump start', icon: 'flash-outline' },
  { id: 'fuel', label: 'Fuel delivery', icon: 'gas-station-outline' },
  { id: 'tyre', label: 'Tyre change', icon: 'tire' },
  { id: 'lockout', label: 'Lockout', icon: 'key-outline' },
  { id: 'repair', label: 'Minor repairs', icon: 'wrench-outline' },
];

export const TOW_VEHICLE_TYPES: { id: TowVehicleType; label: string }[] = [
  { id: 'flatbed_rollback', label: 'Flatbed / Rollback' },
  { id: 'winch_recovery', label: 'Winch Bakkie / Sling Tow' },
  { id: 'standard_tow', label: 'Wheel-lift / light tow' },
  { id: 'heavy_duty', label: 'Heavy duty' },
];

export const DOC_INFO: Record<DocType, { label: string; help: string }> = {
  id_document: { label: 'SA Smart ID or passport', help: 'Clear photo or scan of the ID page.' },
  drivers_license: { label: "Driver's licence (Code 8 / B or EB)", help: 'Front and back on one page if possible.' },
  prdp: { label: 'Professional Driving Permit (PrDP)', help: 'Code EC1 or C1 permit.' },
  vehicle_license_disc: { label: 'Vehicle licence disc', help: 'Current disc for the vehicle you will use.' },
  certificate_of_fitness: { label: 'Certificate of Fitness (CoF)', help: 'Roadworthy certificate for your tow vehicle.' },
  towing_insurance: { label: 'Towing / Goods-in-Transit insurance', help: 'Current policy schedule or certificate.' },
  towing_permit: { label: 'Operating / towing permit', help: 'Optional. SATRA / UTASA affiliation or similar.' },
  trade_certificate: { label: 'Trade test or mechanic qualification', help: 'Optional, but helps approval for repairs.' },
  vehicle_photo: { label: 'Photo of your vehicle', help: 'Side-on photo showing the number plate.' },
  equipment_photo: { label: 'Photo of winch / straps / equipment', help: 'Shows your recovery equipment in working order.' },
};

// Winch Bakkie / Sling Tow operators upload a Code 8/10 PrDP, the standard
// vehicle registration (licence disc), GIT insurance and winch setup photos.
export const isWinchTow = (towType: TowVehicleType | null | undefined) => towType === 'winch_recovery';

const WINCH_DOC_INFO: Partial<Record<DocType, { label: string; help: string }>> = {
  prdp: { label: 'PrDP (Code 8 / 10)', help: 'Professional Driving Permit covering Code 8 or Code 10 licence.' },
  vehicle_license_disc: { label: 'Vehicle registration / licence disc', help: 'Current registration for your winch bakkie or sling tow vehicle.' },
  towing_insurance: { label: 'GIT insurance (Goods-in-Transit)', help: 'Current policy schedule or certificate.' },
  equipment_photo: { label: 'Winch setup verification photos', help: 'Clear photo of your winch / sling fitted to the vehicle, in working order.' },
};

export const docInfo = (type: DocType, towType?: TowVehicleType | null) =>
  (isWinchTow(towType) ? WINCH_DOC_INFO[type] : undefined) ?? DOC_INFO[type];

// Keep in sync with public.partner_required_documents() in the database.
export function requiredDocs(tier: PartnerTier, towType?: TowVehicleType | null): DocType[] {
  if (tier !== 'tow_operator') return ['id_document', 'drivers_license', 'vehicle_license_disc', 'vehicle_photo'];
  if (isWinchTow(towType)) return ['id_document', 'prdp', 'vehicle_license_disc', 'towing_insurance', 'equipment_photo'];
  return ['id_document', 'prdp', 'vehicle_license_disc', 'certificate_of_fitness', 'towing_insurance', 'equipment_photo'];
}

export function optionalDocs(tier: PartnerTier, capabilities: string[]): DocType[] {
  const roadside = capabilities.some((c) => c !== 'flatbed');
  const docs: DocType[] = [];
  if (tier === 'tow_operator') docs.push('towing_permit');
  if (tier === 'roadside_responder' || roadside) docs.push('trade_certificate');
  return docs;
}

export const STATUS_COPY: Record<ApplicationStatus, { title: string; body: string }> = {
  draft: { title: 'Application in progress', body: 'Finish your details and documents, then submit for review.' },
  submitted: { title: 'Under review', body: 'Our team is checking your documents. This usually takes 1–2 working days. We will email you the outcome.' },
  needs_info: { title: 'More information needed', body: 'A reviewer asked for changes. Update your application and submit it again.' },
  approved: { title: 'You are approved', body: 'Welcome to Towber. Sign out and sign back in with the same email to open the TowberPro app.' },
  rejected: { title: 'Application not approved', body: 'Your application was not approved.' },
};
