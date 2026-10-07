import { Alert, type AlertButton } from 'react-native';

export function friendlyError(error: unknown, fallback = 'Something went wrong. Please try again.') {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const message = raw.toLowerCase();
  if (!raw) return fallback;
  if (/network request failed|failed to fetch|network|offline|timeout|timed out|fetch/i.test(message)) {
    return 'We could not connect to Towber. Check your internet connection and try again.';
  }
  if (/jwt|token|session|not authenticated|signed in|auth/i.test(message)) {
    return 'Your session has expired. Please sign in again to continue.';
  }
  if (/permission|not allowed|forbidden|row-level security|42501/i.test(message)) {
    return 'You do not have permission to complete this action.';
  }
  if (/does not exist|schema cache|column|relation|function/i.test(message)) {
    return 'Towber is having trouble loading this feature. Please try again shortly.';
  }
  if (/invalid|malformed|must be|required/i.test(message)) {
    return 'Please check the information and try again.';
  }
  if (/\b(error|exception|postgres|sqlstate|uuid|request_id|status\s*\d{3})\b|[{}[\]<>]/i.test(raw)) {
    return fallback;
  }
  return raw;
}

export function showNotice(title: string, message: string, buttons?: AlertButton[]) {
  Alert.alert(`Towber · ${title}`, friendlyError(message, 'We could not complete that action. Please try again.'), buttons);
}
