import type { ConnectFlowStart } from '@gadgets/workshop-shared/api'
import { NATIVE_AUTH_KEY } from '../native-app/authPopup'

const KEY = 'gadgets.sameTabConnect'
const LIFETIME = 30 * 60 * 1000
const HEX = /^[0-9a-f]{64}$/

/** Starts an explicitly chosen connector flow without a popup; account sign-in is not supported. */
export const continueConnectInTab = (flow: ConnectFlowStart): void => {
  const url = new URL(flow.url)
  if (url.origin !== window.location.origin || !url.pathname.startsWith('/gatekeeper/') ||
      !['http:', 'https:'].includes(url.protocol) || url.username || url.password || !HEX.test(flow.nonce)) {
    throw new Error('Connection must start at a gatekeeper on this install.')
  }
  try {
    sessionStorage.removeItem(NATIVE_AUTH_KEY)
    sessionStorage.setItem(KEY, JSON.stringify({ nonce: flow.nonce, expiresAt: Date.now() + LIFETIME }))
  } catch {
    throw new Error('Allow site storage before continuing in this tab.')
  }
  // The provider must never get a handle on another authenticated Workshop window.
  window.opener = null
  try {
    window.location.assign(url.href)
  } catch (error) {
    try { sessionStorage.removeItem(KEY) } catch { /* Storage may be disabled. */ }
    throw error
  }
}

/** Consumes this tab's connector nonce; the return destination is always /gatekeepers. */
export const readSameTabConnect = (): { kind: 'connect'; nonce: string; sameTab: true } | null => {
  try {
    const raw = sessionStorage.getItem(KEY)
    sessionStorage.removeItem(KEY)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || !('nonce' in value) ||
        typeof value.nonce !== 'string' || !HEX.test(value.nonce) || !('expiresAt' in value) ||
        typeof value.expiresAt !== 'number') return null
    const remaining = value.expiresAt - Date.now()
    if (!(remaining > 0 && remaining <= LIFETIME)) return null
    return { kind: 'connect', nonce: value.nonce, sameTab: true }
  } catch { return null }
}

/** Returning with Back or abandoning setup must not leave a nonce for later popups to inherit. */
export const clearAbandonedSameTabConnect = (): void => {
  if (window.location.pathname === '/connect/handoff') return
  try { sessionStorage.removeItem(KEY) } catch { /* Storage may be disabled. */ }
}
