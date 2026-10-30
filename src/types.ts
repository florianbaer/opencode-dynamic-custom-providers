import type { Model, Provider } from "@opencode/plugin"
import { isValidUrl } from "./security.js"
import type { DisplayStyle, EnrichedModel } from "./discovery.js"

export const PLUGIN_ID = "opencode-dynamic-custom-providers"

// Runtime package OpenCode V2 uses for OpenAI-compatible endpoints.
export const OPENAI_COMPATIBLE_PACKAGE = "@opencode/ai/providers/openai-compatible"

// Per-provider settings live in the plugin options, because V2 config only
// accepts its own keys under `providers`:
//
//   { "package": "opencode-dynamic-custom-providers",
//     "options": { "providers": { "my-proxy": { "dynamic": true, "displayStyle": "name" } } } }
export interface ProviderOptions {
  dynamic?: boolean
  displayStyle?: DisplayStyle
}

export interface PluginOptions {
  displayStyle?: DisplayStyle
  providers?: Record<string, ProviderOptions>
}

// A provider added at runtime with the add-provider tool or /add-provider.
// V2 plugins cannot write opencode.json, so these live in plugin storage.
export interface ManagedProvider {
  id: string
  name: string
  baseURL: string
  apiKey?: string
  displayStyle: DisplayStyle
}

// Everything discovery needs to know about one provider.
export interface DiscoveryTarget {
  id: string
  baseURL: string
  apiKey?: string
  headers?: Record<string, string>
  displayStyle: DisplayStyle
  hasModels: boolean
}

export function envApiKey(providerId: string): string | undefined {
  const envKey = `OPENCODE_LOCAL_${providerId.toUpperCase().replaceAll(/[^A-Z0-9]/g, "_")}_API_KEY`
  return process.env[envKey]
}

function stringSetting(settings: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = settings?.[key]
  return typeof value === "string" && value ? value : undefined
}

export function targetFromProvider(
  info: Provider.Info,
  modelCount: number,
  options: PluginOptions,
): DiscoveryTarget | null {
  const settings = info.settings as Record<string, unknown> | undefined
  const baseURL = stringSetting(settings, "baseURL")
  if (!baseURL || !isValidUrl(baseURL)) return null

  const providerOptions = options.providers?.[info.id] ?? {}
  // Catalog providers (backed by an integration) are only probed when the
  // user opts in; otherwise every inactive catalog entry would be fetched.
  if (info.integrationID && providerOptions.dynamic !== true) return null
  return {
    id: info.id,
    baseURL,
    apiKey: stringSetting(settings, "apiKey") ?? envApiKey(info.id),
    headers: info.headers && Object.keys(info.headers).length > 0 ? { ...info.headers } : undefined,
    displayStyle: providerOptions.displayStyle ?? options.displayStyle ?? "slug",
    hasModels: modelCount > 0 && providerOptions.dynamic !== true,
  }
}

export function targetFromManaged(provider: ManagedProvider): DiscoveryTarget {
  return {
    id: provider.id,
    baseURL: provider.baseURL,
    apiKey: provider.apiKey ?? envApiKey(provider.id),
    displayStyle: provider.displayStyle,
    hasModels: false,
  }
}

export function managedProviderInfo(provider: ManagedProvider): Provider.Info {
  return {
    id: provider.id,
    name: provider.name,
    activation: "enabled",
    package: OPENAI_COMPATIBLE_PACKAGE,
    settings: {
      baseURL: provider.baseURL,
      ...(provider.apiKey ? { apiKey: provider.apiKey } : {}),
    },
  } as unknown as Provider.Info
}

const MODEL_STATUSES = new Set(["alpha", "beta", "deprecated", "active"])

// Converts a discovered model to the V2 Model.Info shape.
export function toModelInfo(providerId: string, modelId: string, model: EnrichedModel): Model.Info {
  const released = model.release_date ? Date.parse(model.release_date) : Number.NaN
  return {
    id: modelId,
    modelID: modelId,
    providerID: providerId,
    name: model.name,
    ...(model.family ? { family: model.family } : {}),
    capabilities: {
      tools: model.tool_call === true,
      input: model.modalities?.input ?? ["text"],
      output: model.modalities?.output ?? ["text"],
      ...(model.temperature !== undefined ? { temperature: model.temperature } : {}),
    },
    variants: [],
    time: { released: Number.isFinite(released) ? released : 0 },
    cost: model.cost
      ? [{
          input: model.cost.input,
          output: model.cost.output,
          cache: { read: model.cost.cache_read ?? 0, write: model.cost.cache_write ?? 0 },
        }]
      : [],
    status: model.status && MODEL_STATUSES.has(model.status) ? model.status : "active",
    enabled: true,
    limit: {
      context: model.limit.context,
      ...(model.limit.input !== undefined ? { input: model.limit.input } : {}),
      output: model.limit.output,
    },
  } as unknown as Model.Info
}

export function toModelInfos(providerId: string, models: Record<string, EnrichedModel>): Model.Info[] {
  return Object.entries(models).map(([id, model]) => toModelInfo(providerId, id, model))
}
