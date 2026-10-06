import { supabase } from './api';

export type SafetyVerificationStatus = 'pending' | 'verified' | 'failed' | 'timed_out';
export type SafetyVerification = {
  id: string;
  request_id: string;
  requested_by: string;
  target_user: string;
  status: SafetyVerificationStatus;
  liveness_score: number | null;
  id_matched: boolean;
  created_at: string;
  expires_at: string;
  completed_at: string | null;
  failure_reason: string | null;
};

export async function requestSafetyVerification(requestId: string) {
  const { data, error } = await supabase.rpc('request_safety_verification', { p_request_id: requestId });
  if (error) throw error;
  return data as SafetyVerification;
}

export async function completeSafetyVerification(id: string, passed: boolean) {
  const { data, error } = await supabase.rpc('complete_safety_verification', {
    p_verification_id: id,
    p_liveness_score: passed ? 0.98 : 0.22,
    p_id_matched: passed,
    p_passed: passed,
  });
  if (error) throw error;
  return data as SafetyVerification;
}

export async function loadLatestSafetyVerification(requestId: string) {
  const { data, error } = await supabase
    .from('safety_verifications')
    .select('id, request_id, requested_by, target_user, status, liveness_score, id_matched, created_at, expires_at, completed_at, failure_reason')
    .eq('request_id', requestId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as SafetyVerification | null;
}

export async function subscribeToSafetyVerification(requestId: string, onChange: (verification: SafetyVerification) => void) {
  const channel = supabase
    .channel(`safety-verification:${requestId}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'safety_verifications', filter: `request_id=eq.${requestId}`,
    }, (payload) => onChange(payload.new as SafetyVerification))
    .subscribe();
  return () => { void supabase.removeChannel(channel); };
}
