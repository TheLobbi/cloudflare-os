import type { AiModelTest } from '@gadgets/workshop-shared/api'

/** Explain safe probe outcomes without surfacing provider-controlled response bodies. */
export const modelTestFailure = (result: Extract<AiModelTest, { ok: false }>): string => {
  if (result.reason === 'timeout') return 'The model did not answer within 30 seconds. Check the server and try again.'
  if (result.reason === 'empty') return 'The model returned no text. Check the exact model ID and try again.'
  if (result.status === 404) return 'HTTP 404: check the API base URL (usually ending in /v1) and the exact model ID.'
  if (result.status === 401 || result.status === 403) return 'The server rejected the credentials. Check the API token and headers.'
  const status = result.status ? `HTTP ${result.status}: ` : ''
  return `${status}the model request failed. Check that the server is reachable and the case-sensitive model ID is available.`
}
