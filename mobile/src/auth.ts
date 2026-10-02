export type AppRole = 'client' | 'driver';

// A magic-link callback can finish while the root layout is still resolving the
// previous anonymous session. Keep the callback's verified role available for
// that single navigation so the stale guest role cannot win the route guard.
let pendingRole: AppRole | null = null;

export function setPendingAuthRole(role: AppRole | null) {
  pendingRole = role;
}

export function getPendingAuthRole() {
  return pendingRole;
}
