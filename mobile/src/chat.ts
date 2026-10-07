import { supabase } from './api';

export type RequestMessage = {
  id: string;
  request_id: string;
  sender_user_id: string;
  body: string;
  created_at: string;
};

export async function loadRequestMessages(requestId: string) {
  const { data, error } = await supabase
    .from('request_messages')
    .select('id, request_id, sender_user_id, body, created_at')
    .eq('request_id', requestId)
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as RequestMessage[];
}

export async function sendRequestMessage(requestId: string, body: string) {
  const clean = body.trim();
  if (!clean) return null;
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const userId = sessionData.session?.user.id;
  if (!userId) throw new Error('Your session has expired. Please sign in again.');
  const { data, error } = await supabase
    .from('request_messages')
    .insert({ request_id: requestId, sender_user_id: userId, body: clean })
    .select('id, request_id, sender_user_id, body, created_at')
    .single();
  if (error) throw error;
  return data as RequestMessage;
}

type ChatChannelStatus = 'SUBSCRIBED' | 'TIMED_OUT' | 'CHANNEL_ERROR' | 'CLOSED';

export function subscribeToRequestMessages(
  requestId: string,
  onMessage: (message: RequestMessage) => void,
  onStatus?: (status: ChatChannelStatus) => void,
) {
  const channel = supabase
    .channel(`request-chat:${requestId}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'request_messages', filter: `request_id=eq.${requestId}`,
    }, (payload) => onMessage(payload.new as RequestMessage))
    .subscribe((status) => onStatus?.(status as ChatChannelStatus));
  return () => { void supabase.removeChannel(channel); };
}

/** Listen for messages on any request the signed-in participant can access. */
export function subscribeToIncomingMessages(
  onMessage: (message: RequestMessage) => void,
  onStatus?: (status: ChatChannelStatus) => void,
) {
  const channel = supabase
    .channel('chat-inbox')
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'request_messages',
    }, (payload) => onMessage(payload.new as RequestMessage))
    .subscribe((status) => onStatus?.(status as ChatChannelStatus));
  return () => { void supabase.removeChannel(channel); };
}

export async function loadMyRating(requestId: string) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const userId = sessionData.session?.user.id;
  if (!userId) return null;
  const { data, error } = await supabase
    .from('request_ratings')
    .select('id, rating, comment, created_at')
    .eq('request_id', requestId)
    .eq('rater_user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data as { id: string; rating: number; comment: string | null; created_at: string } | null;
}

export async function submitRequestRating(requestId: string, rating: number, comment?: string) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const userId = sessionData.session?.user.id;
  if (!userId) throw new Error('Your session has expired. Please sign in again.');
  const { data, error } = await supabase
    .from('request_ratings')
    .insert({ request_id: requestId, rater_user_id: userId, rating, comment: comment?.trim() || null })
    .select('id, rating, comment, created_at')
    .single();
  if (error) throw error;
  return data;
}
