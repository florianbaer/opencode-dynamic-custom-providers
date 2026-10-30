import { discoverAndEnrich, clearModelsDevCache, type DisplayStyle, type EnrichedModel } from "./discovery.ts"
import { isValidUrl, sanitizeErrorMessage } from "./security.ts"
import type { DiscoveryTarget, ManagedProvider } from "./types.ts"

export interface ReloadResult {
  totalModels: number
  failures: number
  providerCount: number
  warnings: string[]
  errors: string[]
}

interface ProviderReloadOutcome {
  providerId: string
  models: Record<string, EnrichedModel> | null
  warning?: string
  error?: string
}

async function reloadOneProvider(
  target: DiscoveryTarget,
  hadModels: boolean,
): Promise<ProviderReloadOutcome> {
  const providerId = target.id

  try {
    const models = await discoverAndEnrich(target.baseURL, target.apiKey, target.displayStyle, target.headers)
    const count = Object.keys(models).length

    if (count > 0) {
      return { providerId, models }
    }

    if (hadModels) {
      return {
        providerId,
        models: null,
        warning: `${providerId} returned 0 models (keeping previous models). Check endpoint status.`,
      }
    }

    return { providerId, models: null }
  } catch (error) {
    return {
      providerId,
      models: null,
      error: `Failed to reload ${providerId}: ${sanitizeErrorMessage(error)}`,
    }
  }
}

// Discovers models for every target that has no models of its own.
// `previous` holds the models discovered last time, so a provider that
// suddenly returns nothing keeps them.
export async function reloadAllProviders(
  targets: DiscoveryTarget[],
  previous: ReadonlyMap<string, unknown>,
  onModels: (providerId: string, models: Record<string, EnrichedModel>) => void,
  options: { clearCache?: boolean } = {},
): Promise<ReloadResult> {
  const dynamicTargets = targets.filter((t) => !t.hasModels)

  const result: ReloadResult = {
    totalModels: 0,
    failures: 0,
    providerCount: dynamicTargets.length,
    warnings: [],
    errors: [],
  }

  if (dynamicTargets.length === 0) return result

  if (options.clearCache) clearModelsDevCache()

  // Each outcome is handled as soon as its endpoint answers, so callers see
  // fast providers without waiting for slow ones.
  const handle = ({ providerId, models, warning, error }: ProviderReloadOutcome) => {
    if (error) {
      result.failures++
      result.errors.push(error)
    } else if (warning) {
      result.warnings.push(warning)
    }

    if (models) {
      onModels(providerId, models)
      result.totalModels += Object.keys(models).length
    }
  }

  await Promise.all(
    dynamicTargets.map((t) =>
      reloadOneProvider(t, previous.has(t.id)).then(handle, (reason: unknown) => {
        result.failures++
        result.errors.push(`Unexpected error: ${sanitizeErrorMessage(reason)}`)
      }),
    ),
  )

  return result
}

export function formatReloadResult(result: ReloadResult): string {
  if (result.providerCount === 0) {
    return "No dynamic providers configured. Add a provider with a baseURL first."
  }

  const lines: string[] = []
  if (result.failures === 0) {
    lines.push(`Reloaded ${result.totalModels} model(s) from ${result.providerCount} provider(s).`)
  } else {
    lines.push(`Reloaded ${result.totalModels} model(s) with ${result.failures} failure(s).`)
  }
  for (const w of result.warnings) lines.push(`Warning: ${w}`)
  for (const e of result.errors) lines.push(`Error: ${e}`)
  return lines.join("\n")
}

export interface AddProviderParams {
  providerId: string
  baseURL: string
  apiKey?: string
  displayStyle?: DisplayStyle
  overwrite?: boolean
}

export interface AddProviderResult {
  success: boolean
  modelCount: number
  message: string
  provider?: ManagedProvider
  models?: Record<string, EnrichedModel>
}

export function validateProviderId(providerId: string): string | null {
  if (!/^[a-zA-Z0-9_-]+$/.test(providerId)) {
    return "Invalid Provider ID. Use alphanumeric, hyphens, or underscores only."
  }
  return null
}

export function validateAddProviderParams(
  params: AddProviderParams,
  existingProviderIds: ReadonlySet<string>,
): string | null {
  const idError = validateProviderId(params.providerId)
  if (idError) return idError
  if (!isValidUrl(params.baseURL)) {
    return "Invalid Base URL. Please enter a full URL (including https://)."
  }
  if (existingProviderIds.has(params.providerId) && !params.overwrite) {
    return `A provider with ID '${params.providerId}' already exists. Set overwrite to true to replace it.`
  }
  return null
}

export async function addProvider(
  params: AddProviderParams,
): Promise<AddProviderResult> {
  const displayStyle = params.displayStyle ?? "slug"
  const baseURL = params.baseURL.trim().replace(/\/+$/, "")

  try {
    const models = await discoverAndEnrich(baseURL, params.apiKey, displayStyle)
    const modelCount = Object.keys(models).length

    if (modelCount === 0) {
      return {
        success: false,
        modelCount: 0,
        message: "No models found at the given endpoint. Provider not added.",
      }
    }

    const provider: ManagedProvider = {
      id: params.providerId,
      name: params.providerId,
      baseURL,
      ...(params.apiKey ? { apiKey: params.apiKey } : {}),
      displayStyle,
    }

    return {
      success: true,
      modelCount,
      message: `Provider '${params.providerId}' added with ${modelCount} model(s).`,
      provider,
      models,
    }
  } catch (error) {
    return {
      success: false,
      modelCount: 0,
      message: `Failed to discover models: ${sanitizeErrorMessage(error)}`,
    }
  }
}
