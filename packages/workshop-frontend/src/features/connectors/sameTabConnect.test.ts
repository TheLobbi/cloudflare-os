// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearAbandonedSameTabConnect, continueConnectInTab, readSameTabConnect } from './sameTabConnect'
import { NATIVE_AUTH_KEY } from '../native-app/authPopup'

const NONCE = 'b'.repeat(64)
const KEY = 'gadgets.sameTabConnect'
const flow = { url: 'http://localhost:8787/gatekeeper/mcp/connect', nonce: NONCE }

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); sessionStorage.clear() })

const location = () => {
  const assign = vi.fn<(url: string) => void>()
  vi.stubGlobal('location', { origin: 'http://localhost:8787', pathname: '/gatekeepers', assign })
  return assign
}

describe('same-tab connector handoff', () => {
  it('keeps the nonce out of the URL, disowns the tab, and consumes it once', () => {
    const assign = location()
    sessionStorage.setItem(NATIVE_AUTH_KEY, 'stale')
    continueConnectInTab(flow)
    expect(window.opener).toBeNull()
    expect(assign).toHaveBeenCalledExactlyOnceWith(flow.url)
    expect(assign.mock.calls[0][0]).not.toContain(NONCE)
    expect(sessionStorage.getItem(NATIVE_AUTH_KEY)).toBeNull()
    expect(readSameTabConnect()).toEqual({ kind: 'connect', nonce: NONCE, sameTab: true })
    expect(readSameTabConnect()).toBeNull()
  })

  it.each([
    'https://attacker.example/gatekeeper/mcp/connect',
    'http://localhost:8787/providers',
    'http://user:pass@localhost:8787/gatekeeper/mcp/connect',
    'javascript:alert(1)',
  ])('refuses an untrusted start URL: %s', (url) => {
    const assign = location()
    expect(() => continueConnectInTab({ ...flow, url })).toThrow('Connection must start at a gatekeeper on this install.')
    expect(assign).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })

  it('does not navigate if storage is unavailable', () => {
    const assign = location()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    expect(() => continueConnectInTab(flow)).toThrow('Allow site storage')
    expect(assign).not.toHaveBeenCalled()
  })

  it('clears the nonce when navigation throws', () => {
    const assign = location()
    const navigationError = new Error('navigation blocked')
    assign.mockImplementation(() => { throw navigationError })

    expect(() => continueConnectInTab(flow)).toThrow(navigationError)
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })

  it.each([-1, 0, 30 * 60 * 1000 + 1])('rejects a record with invalid remaining lifetime %s', (remaining) => {
    vi.spyOn(Date, 'now').mockReturnValue(100)
    sessionStorage.setItem(KEY, JSON.stringify({ nonce: NONCE, expiresAt: 100 + remaining }))
    expect(readSameTabConnect()).toBeNull()
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })

  it('clears an abandoned flow on normal entry but retains it for the handoff page', () => {
    location()
    continueConnectInTab(flow)
    vi.stubGlobal('location', { pathname: '/connect/handoff' })
    clearAbandonedSameTabConnect()
    expect(sessionStorage.getItem(KEY)).not.toBeNull()
    vi.stubGlobal('location', { pathname: '/gatekeepers' })
    clearAbandonedSameTabConnect()
    expect(readSameTabConnect()).toBeNull()
  })
})
