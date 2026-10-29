import { useState, useEffect, useRef } from 'react'
import { Banner, Dialog, Button, Input, Select, Collapsible, useKumoToastManager } from '@cloudflare/kumo'
import { AiModelProvider, AiGatewayInfo, RedactedAiModelConfig, SUGGESTED_MODELS, modelKind } from '@gadgets/workshop-shared/api'
import { RpcStub } from 'capnweb'
import { AuthenticatedApi } from '@gadgets/workshop-shared/api'
import { ExtraHeadersEditor } from './features/ai-models/ExtraHeadersEditor'
import { StoredSecretInput } from './features/ai-models/StoredSecretInput'
import {
  headerRowsFromRecord, validateHeaderRows, type HeaderRow,
} from './features/ai-models/extraHeaders'
import { suggestedOpenAiBaseUrl, PROVIDER_LABELS, parseTokenLimit } from './features/ai-models/modelForm'
import { modelTestFailure } from './features/ai-models/modelTest'
import { buildModelConfig, initialModelFields, tokenDescription, modelProfile, modelPresentation,
  modelCredentials, isTokenRequired, type ModelModalMode, type SelectionType } from './features/ai-models/modelDraft'
export type { ModelModalMode } from './features/ai-models/modelDraft'

interface AddModelModalProps {
  visible: boolean
  onCancel: () => void
  onSuccess: () => void
  authenticatedApi: RpcStub<AuthenticatedApi>
  aiConfig: AiGatewayInfo | null
  mode?: ModelModalMode
  /** Leave decision models out, for callers choosing the user's chat model. */
  chatModelsOnly?: boolean
}

// Encode a selection into a string value for the Select component.
function encodeSelection(provider: AiModelProvider, modelId?: string): string {
  return modelId ? `${provider}:${modelId}` : `other-${provider}`
}

// Decode a Select value back into a SelectionType.
function decodeSelection(value: string): SelectionType {
  if (value.startsWith('other-')) {
    return { type: 'custom', provider: value.substring(6) as AiModelProvider }
  }
  const colonIndex = value.indexOf(':')
  const provider = value.substring(0, colonIndex) as AiModelProvider
  const modelId = value.substring(colonIndex + 1)
  const displayName = SUGGESTED_MODELS[provider][modelId].name
  return { type: 'suggested', provider, modelId, displayName }
}

// Build the flat list of options for the Select dropdown.
function buildOptions(gatewayMode: boolean, enabledProviders: Set<string> | null, chatModelsOnly: boolean) {
  const options: { value: string; label: string; provider: string }[] = []
  const providerOrder = Object.keys(SUGGESTED_MODELS) as AiModelProvider[]

  for (const provider of providerOrder) {
    // Auto Router's one model is the deployment's; it runs only through a gateway.
    if (provider === 'cloudflare-auto-router') continue
    if (enabledProviders && !enabledProviders.has(provider)) continue

    // In gateway mode, suggested models are already built-in, so don't list them.
    if (!gatewayMode) {
      for (const [modelId, model] of Object.entries(SUGGESTED_MODELS[provider])) {
        if (model.hidden || (chatModelsOnly && model.kind === 'decision')) continue
        options.push({
          value: encodeSelection(provider, modelId),
          label: model.name,
          provider,
        })
      }
    }

    options.push({
      value: encodeSelection(provider),
      label: `Other ${PROVIDER_LABELS[provider] || provider}...`,
      provider,
    })
  }

  return options
}


const groupOptions = (options: ReturnType<typeof buildOptions>) => {
  const groups: { provider: string; items: typeof options }[] = []
  for (const opt of options) {
    const last = groups[groups.length - 1]
    if (last && last.provider === opt.provider) last.items.push(opt)
    else groups.push({ provider: opt.provider, items: [opt] })
  }
  return groups
}

export default function AddModelModal({ visible, onCancel, onSuccess, authenticatedApi, aiConfig, mode = { type: 'add' }, chatModelsOnly = false }: AddModelModalProps) {
  const toasts = useKumoToastManager()

  // Edit and clone modes take their initial state from the source model, so the caller remounts
  // the modal (with a `key`) to switch source.
  const initial = initialModelFields(mode)
  const { source, editing } = initial

  const [loading, setLoading] = useState(false)
  const [testError, setTestError] = useState<string | null>(null)
  const requestId = useRef(0)
  useEffect(() => () => { requestId.current++ }, [visible])
  const [selection, setSelection] = useState<SelectionType | null>(
    initial.selection)
  const [selectValue, setSelectValue] = useState<string | undefined>(undefined)

  // Form fields (used for custom models). A null secret keeps the source's withheld value.
  const [modelId, setModelId] = useState(initial.modelId)
  const [displayName, setDisplayName] = useState(initial.displayName)
  const [apiToken, setApiToken] = useState<string | null>(initial.apiToken)
  const [accountId, setAccountId] = useState(initial.accountId)
  const [apiUrl, setApiUrl] = useState(initial.apiUrl)
  const [headerRows, setHeaderRows] = useState<HeaderRow[]>(() => headerRowsFromRecord(source?.config.extraHeaders))
  // Token limits are specific to a model, so a clone doesn't inherit them.
  const [contextWindow, setContextWindow] = useState(initial.contextWindow)
  const [outputLimit, setOutputLimit] = useState(initial.outputLimit)

  // Validation errors
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [headerErrors, setHeaderErrors] = useState<Record<number, string>>({})

  // Advanced settings collapsible state
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const gatewayMode = aiConfig?.enabled === true
  const enabledProviders: Set<string> | null = gatewayMode
    ? new Set(aiConfig.enabledProviders)
    : null

  // The server keeps withheld secrets only for the endpoint they were configured for. Once the URL
  // changes, withheld values are shown (and sent) as blank, and header values must be re-entered.
  const { storedSecretsUsable, effectiveApiToken } = modelCredentials(source, apiUrl, apiToken)

  // Reset all state when dialog closes
  useEffect(() => {
    if (!visible) {
      setSelection(null)
      setSelectValue(undefined)
      setModelId('')
      setDisplayName('')
      setApiToken('')
      setAccountId('')
      setApiUrl('')
      setHeaderRows([])
      setContextWindow('')
      setOutputLimit('')
      setErrors({})
      setHeaderErrors({})
      setAdvancedOpen(false)
      setLoading(false)
      setTestError(null)
    }
  }, [visible])

  const handleModelSelect = (value: string) => {
    setSelectValue(value)
    setErrors({})
    setHeaderErrors({})
    const sel = decodeSelection(value)
    setSelection(sel)

    if (sel.type === 'custom') {
      setModelId('')
      setDisplayName('')
    } else {
      setModelId(sel.modelId)
      setDisplayName(sel.displayName)
    }
    setApiToken('')
    setAccountId('')
    setApiUrl(sel.provider === 'ollama' ? 'http://localhost:11434' : '')
    setHeaderRows([])
    setContextWindow('')
    setOutputLimit('')
  }

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!selection) {
      newErrors.selection = gatewayMode ? 'Please select a provider' : 'Please select a model'
    }

    if (selection?.type === 'custom') {
      if (!modelId.trim()) newErrors.modelId = 'Please enter the model ID'
      // The caller lists only language models, so a decision model saved here would never show up there.
      else if (chatModelsOnly && modelKind(selection.provider, modelId.trim()) === 'decision') {
        newErrors.modelId = "This is a decision model, which can't chat. Add it from AI Providers instead."
      }
      if (!displayName.trim()) newErrors.displayName = 'Please enter a display name'
    }

    const isOllama = selection?.provider === 'ollama'
    const isCloudflare = selection?.provider === 'cloudflare'
    const showCredentials = !gatewayMode

    if (showCredentials && selection && isTokenRequired(selection.provider, headerRows) && effectiveApiToken?.trim() === '') {
      newErrors.apiToken = apiToken === null
        ? 'Please re-enter your API token, since the API URL changed'
        : 'Please enter your API token'
    }

    if (showCredentials && isCloudflare && !accountId.trim()) {
      newErrors.accountId = 'Please enter your Cloudflare account ID'
    }

    if (showCredentials && isOllama && !apiUrl.trim()) {
      newErrors.apiUrl = 'Please enter the Ollama API URL'
    }

    if (parseTokenLimit(contextWindow) === null) {
      newErrors.contextWindow = 'Please enter a positive whole number of tokens'
    }
    if (parseTokenLimit(outputLimit) === null) {
      newErrors.outputLimit = 'Please enter a positive whole number of tokens'
    }

    const newHeaderErrors = showCredentials ? validateHeaderRows(headerRows) : {}
    if (showCredentials && !storedSecretsUsable) {
      for (const row of headerRows) {
        if (row.value === null && !newHeaderErrors[row.id]) {
          newHeaderErrors[row.id] = "Please re-enter this header's value, since the API URL changed"
        }
      }
    }
    // These fields live in the collapsible, so reveal their errors if it was closed.
    if (Object.keys(newHeaderErrors).length > 0 || newErrors.contextWindow || newErrors.outputLimit) {
      setAdvancedOpen(true)
    }

    setErrors(newErrors)
    setHeaderErrors(newHeaderErrors)
    return Object.keys(newErrors).length === 0 && Object.keys(newHeaderErrors).length === 0
  }

  const testBeforeSave = async (config: RedactedAiModelConfig, request: number) => {
    if (gatewayMode || config.provider !== 'openai') return true
    const result = await authenticatedApi.testModel(config, source?.profile.id)
    if (request !== requestId.current) return false
    if (result.ok) return true
    setTestError(modelTestFailure(result))
    return false
  }

  const handleSubmit = async () => {
    if (!validate()) return

    const request = ++requestId.current
    setLoading(true)
    setTestError(null)
    try {
      const finalModelId = selection!.type === 'suggested' ? selection!.modelId : modelId.trim()
      const profile = modelProfile(selection!, mode, finalModelId, displayName)

      const config = buildModelConfig({ provider: selection!.provider, model: finalModelId,
        gatewayMode, apiToken: effectiveApiToken, accountId, apiUrl, headerRows, contextWindow, outputLimit })

      if (!await testBeforeSave(config, request)) return
      if (request !== requestId.current) return
      if (editing) {
        await authenticatedApi.updateModel(profile, config)
      } else {
        await authenticatedApi.addModel(profile, config, source?.profile.id)
      }
      if (request !== requestId.current) return
      toasts.add({ title: editing ? 'AI model updated successfully' : 'AI model added successfully', variant: 'success' })
      onSuccess()
    } catch (error: any) {
      if (request !== requestId.current) return
      console.error('Failed to save model:', error)
      toasts.add({
        title: editing ? 'Failed to update model' : 'Failed to add model',
        description: error?.message,
        variant: 'error',
      })
    } finally {
      if (request === requestId.current) setLoading(false)
    }
  }

  const options = buildOptions(gatewayMode, enabledProviders, chatModelsOnly)
  const { showCustomFields, example, isOllama, isCloudflare, showCredentials, tokenPlaceholder } = modelPresentation(selection, gatewayMode, headerRows)
  const title = { add: 'Add AI Model', edit: 'Edit AI Model', clone: 'Clone AI Model' }[mode.type]
  const suggestedApiUrl = selection && suggestedOpenAiBaseUrl(selection.provider, apiUrl)

  const groupedOptions = groupOptions(options)

  return (
    <Dialog.Root open={visible} onOpenChange={(open) => { if (!open && !loading) onCancel() }}>
      <Dialog className="responsive-dialog overflow-y-auto p-6" size="lg">
        <Dialog.Title className="text-lg font-semibold mb-4">
          {title}
        </Dialog.Title>

        <fieldset disabled={loading} className="space-y-4">
          {/* Model / Provider selection */}
          {source ? (
            <Input
              label="Provider"
              value={PROVIDER_LABELS[source.config.provider] || source.config.provider}
              disabled
            />
          ) : (
          <Select
            label={gatewayMode ? 'Select Provider' : 'Select Model'}
            className="w-full text-sm"
            placeholder={gatewayMode ? 'Choose a provider...' : 'Choose an AI model...'}
            value={selectValue}
            onValueChange={(v) => handleModelSelect(v as string)}
            error={errors.selection}
            renderValue={(v) => {
              const opt = options.find(o => o.value === v)
              return opt?.label ?? String(v)
            }}
          >
            {groupedOptions.map((group, groupIndex) => (
              <div key={group.provider}>
                {groupIndex > 0 && (
                  <div className="h-px bg-kumo-line my-1 mx-2" />
                )}
                <div className="px-3 py-1.5 text-xs font-medium text-kumo-subtle select-none">
                  {PROVIDER_LABELS[group.provider as AiModelProvider] || group.provider}
                </div>
                {group.items.map(opt => (
                  <Select.Option key={opt.value} value={opt.value}>
                    {opt.label}
                  </Select.Option>
                ))}
              </div>
            ))}
          </Select>
          )}

          {/* Custom model fields */}
          {showCustomFields && (
            <>
              <Input
                label="Model ID"
                placeholder={`e.g., ${example!.modelId}`}
                description={`The model identifier as specified by the provider (e.g., '${example!.modelId}')`}
                value={modelId}
                disabled={editing}
                onChange={(e) => { setModelId(e.target.value); setErrors(prev => ({ ...prev, modelId: '' })) }}
                error={errors.modelId}
                variant={errors.modelId ? 'error' : 'default'}
              />

              <Input
                label="Display Name"
                placeholder={`e.g., ${example!.name}`}
                description="Human-readable name shown in the UI"
                value={displayName}
                onChange={(e) => { setDisplayName(e.target.value); setErrors(prev => ({ ...prev, displayName: '' })) }}
                error={errors.displayName}
                variant={errors.displayName ? 'error' : 'default'}
              />
            </>
          )}

          {/* Cloudflare account ID (the Workers AI REST endpoint is account-scoped) */}
          {showCredentials && isCloudflare && (
            <Input
              label="Cloudflare Account ID"
              placeholder="e.g., 0123456789abcdef0123456789abcdef"
              description="The Cloudflare account to bill for Workers AI usage"
              value={accountId}
              onChange={(e) => { setAccountId(e.target.value); setErrors(prev => ({ ...prev, accountId: '' })) }}
              error={errors.accountId}
              variant={errors.accountId ? 'error' : 'default'}
            />
          )}

          {/* API Token */}
          {showCredentials && selection && (
            <StoredSecretInput
              label="API Token"
              stored={storedSecretsUsable && source!.config.apiToken === null}
              placeholder={tokenPlaceholder}
              description={tokenDescription(selection.provider)}
              value={effectiveApiToken}
              onValueChange={(v) => { setApiToken(v); setErrors(prev => ({ ...prev, apiToken: '' })) }}
              error={errors.apiToken}
            />
          )}

          {/* Ollama API URL (always visible for Ollama) */}
          {showCredentials && isOllama && (
            <Input
              label="API URL"
              placeholder="http://localhost:11434"
              description="URL of your Ollama server"
              value={apiUrl}
              onChange={(e) => { setApiUrl(e.target.value); setErrors(prev => ({ ...prev, apiUrl: '' })) }}
              error={errors.apiUrl}
              variant={errors.apiUrl ? 'error' : 'default'}
            />
          )}

          {selection && (
            <Collapsible.Root
              open={advancedOpen}
              onOpenChange={setAdvancedOpen}
            >
              <Collapsible.DefaultTrigger>Advanced Settings</Collapsible.DefaultTrigger>
              <Collapsible.DefaultPanel>
                <div className="space-y-4">
                  {/* Ollama shows its API URL above; Workers AI's endpoint is derived from the account ID. */}
                  {showCredentials && !isOllama && !isCloudflare && (
                    <Input
                      label="API URL"
                      placeholder="https://..."
                      description={selection.provider === 'openai'
                        ? 'OpenAI Responses API base URL, usually ending in /v1. Model IDs are case-sensitive.'
                        : 'Override the default API endpoint (useful for proxies like Cloudflare AI Gateway)'}
                      value={apiUrl}
                      onChange={(e) => setApiUrl(e.target.value)}
                    />
                  )}
                  {showCredentials && suggestedApiUrl && (
                    <div className="space-y-2 text-sm text-kumo-subtle">
                      <p>Most OpenAI-compatible servers require /v1. Changing the URL requires re-entering stored credentials.</p>
                      <Button onClick={() => setApiUrl(suggestedApiUrl)}>Use {suggestedApiUrl}</Button>
                    </div>
                  )}
                  {showCredentials && (
                    <ExtraHeadersEditor
                      rows={headerRows}
                      storedValuesUsable={storedSecretsUsable}
                      errors={headerErrors}
                      onRowsChange={(rows) => {
                        setHeaderRows(rows)
                        setHeaderErrors({})
                        // Adding a header can make the token optional.
                        setErrors(prev => ({ ...prev, apiToken: '' }))
                      }}
                    />
                  )}
                  <Input
                    label="Context Window"
                    inputMode="numeric"
                    placeholder="(default)"
                    description="The maximum tokens one request may total. Leave blank to use the model's built-in default."
                    value={contextWindow}
                    onChange={(e) => { setContextWindow(e.target.value); setErrors(prev => ({ ...prev, contextWindow: '' })) }}
                    error={errors.contextWindow}
                    variant={errors.contextWindow ? 'error' : 'default'}
                  />
                  <Input
                    label="Output Limit"
                    inputMode="numeric"
                    placeholder="(default)"
                    description="The maximum tokens in one response, also reserved out of the context window. Leave blank to use the model's built-in default."
                    value={outputLimit}
                    onChange={(e) => { setOutputLimit(e.target.value); setErrors(prev => ({ ...prev, outputLimit: '' })) }}
                    error={errors.outputLimit}
                    variant={errors.outputLimit ? 'error' : 'default'}
                  />
                </div>
              </Collapsible.DefaultPanel>
            </Collapsible.Root>
          )}
        </fieldset>

        {!gatewayMode && selection?.provider === 'openai' && (
          <p className="mt-4 text-sm text-kumo-subtle">
            Saving first sends a small test request (up to 256 tokens). Only a model that answers
            is saved. This tests the model connection; tools and gadget rendering still need verification.
          </p>
        )}
        {testError && <Banner className="mt-4" variant="error" title="Model was not saved" description={testError} />}

        {/* Footer */}
        <div className="mt-6 flex justify-end gap-2">
          <Dialog.Close render={(props) => (
            <Button variant="secondary" {...props} disabled={loading}>
              Cancel
            </Button>
          )} />
          <Button
            variant="primary"
            onClick={handleSubmit}
            loading={loading}
            disabled={!selection}
          >
            {editing ? 'Save Changes' : 'Add Model'}
          </Button>
        </div>
      </Dialog>
    </Dialog.Root>
  )
}
