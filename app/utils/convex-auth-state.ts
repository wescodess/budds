export function isCurrentAuthenticatedCallback(
  callbackEpoch: number,
  currentEpoch: number,
  sessionLoggedIn: boolean,
  convexAuthenticated: boolean,
) {
  return callbackEpoch === currentEpoch
    && sessionLoggedIn
    && convexAuthenticated
}
