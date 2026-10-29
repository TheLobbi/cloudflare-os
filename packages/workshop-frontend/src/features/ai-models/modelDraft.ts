import type { AiChatAuthorInfo, AiModelProvider, RedactedAiModelConfig } from '@gadgets/workshop-shared/api'
import { SUGGESTED_MODELS } from '@gadgets/workshop-shared/api'
import { headerRowsToRecord, type HeaderRow } from './extraHeaders'
import { PROVIDER_LABELS, parseTokenLimit } from './modelForm'

/**
 * Whether the modal adds a model from scratch, edits a stored one, or adds a model based on a
 * stored one, with the stored model's withheld secrets carried over.
 */
export type ModelModalMode =
  | { type: 'add' }
  | { type: 'edit' | 'clone', source: { profile: AiChatAuthorInfo, config: RedactedAiModelConfig } }

export type SelectionType =
  | { type: 'suggested', provider: AiModelProvider, modelId: string, displayName: string }
  | { type: 'custom', provider: AiModelProvider }

// Placeholder hinting at the shape of each provider's API token.
const API_TOKEN_PLACEHOLDERS: Record<AiModelProvider, string> = {
  anthropic: 'sk-ant-...',
  openai: 'sk-...',
  google: 'AIza...',
  cloudflare: 'Cloudflare API token',
  ollama: '(optional)',
  // Never shown: Auto Router's one model is the deployment's (see AiGatewayInfo.enabledProviders).
  'cloudflare-auto-router': '',
}

// Providers whose client can send no API key at all, so a proxy that extra headers authenticate
// can supply its own (AI Gateway only injects a stored key into requests that carry none). Google's
// SDK always sends a key, and the Workers AI endpoint can't be redirected to a proxy.
const TOKEN_OPTIONAL_WITH_HEADERS: ReadonlySet<AiModelProvider> = new Set(['anthropic', 'openai'])

export const isTokenRequired = (provider: AiModelProvider, headerRows: readonly HeaderRow[]) =>
  provider !== 'ollama' &&
  !(TOKEN_OPTIONAL_WITH_HEADERS.has(provider) && headerRowsToRecord(headerRows) !== undefined)

// Example used in the custom-model placeholders for providers that have no suggested models
// (currently Ollama, which serves whatever the user has pulled locally).
const FALLBACK_EXAMPLE_MODEL = { modelId: 'gemma4:31b', name: 'Gemma 4 31B' }

// Pick an example model to show in the custom-model placeholders for the given provider.
function exampleModel(provider: AiModelProvider): { modelId: string, name: string } {
  const first = Object.entries(SUGGESTED_MODELS[provider])[0]
  return first ? { modelId: first[0], name: first[1].name } : FALLBACK_EXAMPLE_MODEL
}

export const buildModelConfig = ({ provider, model, gatewayMode, apiToken, accountId, apiUrl, headerRows, contextWindow, outputLimit }: {
  provider: AiModelProvider; model: string; gatewayMode: boolean; apiToken: string | null;
  accountId: string; apiUrl: string; headerRows: HeaderRow[]; contextWindow: string; outputLimit: string;
}): RedactedAiModelConfig => {
  const extraHeaders = gatewayMode ? undefined : headerRowsToRecord(headerRows)
  const contextWindowTokens = parseTokenLimit(contextWindow)
  const outputLimitTokens = parseTokenLimit(outputLimit)
  return {
    provider, model,
    apiToken: gatewayMode ? '' : apiToken?.trim() ?? null,
    ...(!gatewayMode && accountId.trim() && { accountId: accountId.trim() }),
    ...(!gatewayMode && apiUrl.trim() && { apiUrl: apiUrl.trim() }),
    ...(extraHeaders && { extraHeaders }),
    ...(contextWindowTokens && { contextWindow: contextWindowTokens }),
    ...(outputLimitTokens && { outputLimit: outputLimitTokens }),
  }
}

export const initialModelFields = (mode: ModelModalMode) => {
  const source = mode.type === 'add' ? null : mode.source
  const config = source?.config
  const editing = mode.type === 'edit'
  return {
    source, editing,
    selection: source ? { type: 'custom' as const, provider: source.config.provider } : null,
    modelId: editing ? source!.config.model : '',
    displayName: editing ? source!.profile.name : '',
    apiToken: config ? config.apiToken : '',
    accountId: config?.accountId ?? '', apiUrl: config?.apiUrl ?? '',
    contextWindow: editing ? String(config?.contextWindow ?? '') : '',
    outputLimit: editing ? String(config?.outputLimit ?? '') : '',
  }
}

export const tokenDescription = (provider: AiModelProvider) => {
  if (provider === 'ollama') return 'Optional for local Ollama access'
  if (provider === 'cloudflare') return 'An API token with Workers AI Read + Edit permissions (in the dashboard: Workers AI > Use REST API > Create a Workers AI API Token)'
  if (TOKEN_OPTIONAL_WITH_HEADERS.has(provider)) return `Your ${PROVIDER_LABELS[provider]} API token for billing. Leave blank if the extra headers under Advanced Settings authenticate you to a proxy that supplies its own key.`
  return `Your ${PROVIDER_LABELS[provider]} API token for billing`
}

export const modelProfile = (selection: SelectionType, mode: ModelModalMode, modelId: string, displayName: string): AiChatAuthorInfo => ({
  type: 'agent',
  // Chats refer to this identity, so editing must preserve it.
  id: mode.type === 'edit' ? mode.source.profile.id : modelId,
  name: selection.type === 'suggested' ? selection.displayName : displayName.trim(),
})

export const modelPresentation = (selection: SelectionType | null, gatewayMode: boolean, headerRows: HeaderRow[]) => ({
  showCustomFields: selection?.type === 'custom',
  example: selection ? exampleModel(selection.provider) : null,
  isOllama: selection?.provider === 'ollama',
  isCloudflare: selection?.provider === 'cloudflare',
  showCredentials: !gatewayMode,
  tokenPlaceholder: selection && isTokenRequired(selection.provider, headerRows)
    ? API_TOKEN_PLACEHOLDERS[selection.provider] : '(optional)',
})

export const modelCredentials = (source: ReturnType<typeof initialModelFields>['source'], apiUrl: string, apiToken: string | null) => {
  const storedSecretsUsable = source !== null && apiUrl.trim() === (source.config.apiUrl ?? '')
  return { storedSecretsUsable, effectiveApiToken: apiToken === null && !storedSecretsUsable ? '' : apiToken }
}
