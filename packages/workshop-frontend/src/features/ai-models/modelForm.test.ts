import { describe, expect, it } from 'vitest'
import { suggestedOpenAiBaseUrl } from './modelForm'

describe('suggestedOpenAiBaseUrl', () => {
  it('adds /v1 to an OpenAI-compatible host-only URL', () => {
    expect(suggestedOpenAiBaseUrl('openai', 'http://127.0.0.1:8317')).toBe('http://127.0.0.1:8317/v1')
    expect(suggestedOpenAiBaseUrl('openai', 'https://proxy.example/')).toBe('https://proxy.example/v1')
  })

  it('preserves explicit paths and other provider URLs', () => {
    expect(suggestedOpenAiBaseUrl('openai', 'http://127.0.0.1:8317/custom')).toBeNull()
    expect(suggestedOpenAiBaseUrl('anthropic', 'http://127.0.0.1:8317')).toBeNull()
  })
})
