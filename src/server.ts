import { Plugin, type Model, type Provider } from "@opencode/plugin"
import {
  reloadAllProviders,
  formatReloadResult,
  addProvider,
  validateAddProviderParams,
  type AddProviderParams,
  type AddProviderResult,
} from "./commands.js"
import { DynamicProviders } from "./rpc.js"
import { sanitizeErrorMessage } from "./security.js"
import {
  PLUGIN_ID,
  OPENAI_COMPATIBLE_PACKAGE,
  managedProviderInfo,
  targetFromManaged,
  targetFromProvider,
  toModelInfos,
  type DiscoveryTarget,
  type ManagedProvider,
  type PluginOptions,
} from "./types.js"

export { DynamicProviders } from "./rpc.js"
export type { ManagedProvider, PluginOptions, ProviderOptions } from "./types.js"

const STORAGE_PREFIX = "provider/"

const ADD_PROVIDER_INPUT = {
  type: "object",
  properties: {
    providerId: {
      type: "string",
      description: "Unique provider ID (alphanumeric, hyphens, underscores only)",
    },
    baseURL: {
      type: "string",
      description: "Base URL of the OpenAI-compatible API endpoint (e.g. https://api.example.com/v1)",
    },
    apiKey: { type: "string", description: "API key for authentication (optional)" },
    displayStyle: {
      type: "string",
      enum: ["slug", "name"],
      description: "How to display model names: 'slug' for full ID (default), 'name' for friendly name",
    },
    overwrite: {
      type: "boolean",
      description: "Overwrite if a provider with this ID already exists (default: false)",
    },
  },
  required: ["providerId", "baseURL"],
  additionalProperties: false,
} as const

const EMPTY_INPUT = { type: "object", properties: {}, additionalProperties: false } as const

export default Plugin.define({
  id: PLUGIN_ID,
  async setup(ctx) {
    const options = (ctx.options ?? {}) as PluginOptions

    const managed = new Map<string, ManagedProvider>()
    let after: string | undefined
    do {
      const page = await ctx.storage.scan({ prefix: STORAGE_PREFIX, after })
      for (const entry of page.entries) {
        const provider = entry.value as unknown as ManagedProvider
        if (provider?.id && provider.baseURL) managed.set(provider.id, provider)
      }
      after = page.next
    } while (after)

    // Discovered models per provider. Transforms must be synchronous, so
    // discovery runs outside them and calls reload() when it has results.
    const discovered = new Map<string, Model.Info[]>()
    // Providers we already tried, so a replayed transform doesn't rediscover.
    const attempted = new Set<string>()
    let configTargets: DiscoveryTarget[] = []
    // Providers defined in the user's config never appear in the editor, so
    // they are read from the provider API instead and injected when discovered.
    const catalogIds = new Set<string>()
    const configOnly = new Map<string, { info: Provider.Info; target: DiscoveryTarget }>()

    const allTargets = (): DiscoveryTarget[] => [
      ...configTargets,
      ...[...configOnly.values()].map((c) => c.target),
      ...[...managed.values()].map(targetFromManaged),
    ]

    const refresh = async (targets: DiscoveryTarget[], clearCache: boolean) => {
      for (const t of targets) attempted.add(t.id)
      const result = await reloadAllProviders(
        targets,
        discovered,
        (providerId, models) => discovered.set(providerId, toModelInfos(providerId, models)),
        { clearCache },
      )
      if (result.totalModels > 0) await ctx.provider.reload()
      for (const e of result.errors) console.warn(`[${PLUGIN_ID}] ${e}`)
      return result
    }

    await ctx.provider.transform((editor) => {
      const targets: DiscoveryTarget[] = []
      for (const record of editor.list()) {
        catalogIds.add(record.provider.id)
        if (managed.has(record.provider.id)) continue
        const target = targetFromProvider(record.provider, record.models.size, options)
        if (target) targets.push(target)
      }
      configTargets = targets

      for (const provider of managed.values()) {
        if (editor.get(provider.id)) editor.remove(provider.id)
        editor.add({ info: managedProviderInfo(provider), models: discovered.get(provider.id) ?? [] })
      }

      for (const [providerId, models] of discovered) {
        if (managed.has(providerId)) continue
        const record = editor.get(providerId)
        const external = configOnly.get(providerId)
        if (!record && external) {
          editor.add({
            info: { ...external.info, package: external.info.package ?? OPENAI_COMPATIBLE_PACKAGE } as Provider.Info,
            models,
          })
          continue
        }
        if (!record) continue
        if (!record.provider.package) {
          editor.update(providerId, (p) => {
            p.package = OPENAI_COMPATIBLE_PACKAGE
          })
        }
        editor.models.set(providerId, models)
      }

      const pending = allTargets().filter((t) => !t.hasModels && !attempted.has(t.id))
      if (pending.length > 0) {
        for (const t of pending) attempted.add(t.id)
        queueMicrotask(() => {
          refresh(pending, false).catch((error) =>
            console.warn(`[${PLUGIN_ID}] Discovery failed: ${sanitizeErrorMessage(error)}`),
          )
        })
      }
    })

    const loadConfigProviders = async () => {
      const listed = await ctx.provider.list()
      const found: DiscoveryTarget[] = []
      for (const info of listed.data as unknown as Provider.Info[]) {
        if (catalogIds.has(info.id) || managed.has(info.id) || configOnly.has(info.id)) continue
        const target = targetFromProvider(info, 0, options)
        if (!target) continue
        configOnly.set(info.id, { info, target })
        found.push(target)
      }
      const pending = found.filter((t) => !attempted.has(t.id))
      if (pending.length > 0) await refresh(pending, false)
    }

    // The config layer loads after plugins start, so keep looking for a short while.
    const scanConfigProviders = async (attempt = 0): Promise<void> => {
      try {
        await loadConfigProviders()
      } catch (error) {
        console.warn(`[${PLUGIN_ID}] Discovery failed: ${sanitizeErrorMessage(error)}`)
      }
      if (attempt < 6) setTimeout(() => void scanConfigProviders(attempt + 1), 1000 * 2 ** attempt)
    }
    queueMicrotask(() => void scanConfigProviders())

    const reloadModels = () => refresh(allTargets(), true)

    const knownProviderIds = () =>
      new Set([...configTargets.map((t) => t.id), ...managed.keys()])

    const addManagedProvider = async (params: AddProviderParams): Promise<AddProviderResult> => {
      const providers = await ctx.provider.list()
      const existing = new Set([...providers.data.map((p) => p.id as string), ...knownProviderIds()])
      const validationError = validateAddProviderParams(params, existing)
      if (validationError) return { success: false, modelCount: 0, message: validationError }

      const result = await addProvider(params)
      if (!result.success || !result.provider || !result.models) return result

      await ctx.storage.set(STORAGE_PREFIX + result.provider.id, result.provider as never)
      managed.set(result.provider.id, result.provider)
      attempted.add(result.provider.id)
      discovered.set(result.provider.id, toModelInfos(result.provider.id, result.models))
      await ctx.provider.reload()
      return result
    }

    await ctx.tool.transform((editor) => {
      editor.add({
        name: "refresh-models",
        description:
          "Re-discover models from all dynamic providers and update the live provider list. " +
          "Clears the models.dev metadata cache, fetches /models from every provider " +
          "with a baseURL, and enriches them.",
        input: EMPTY_INPUT,
        async execute() {
          return { content: formatReloadResult(await reloadModels()) }
        },
      })

      editor.add({
        name: "add-provider",
        description:
          "Add a new OpenAI-compatible provider with dynamic model discovery. " +
          "Validates the endpoint, discovers available models, enriches them with " +
          "models.dev metadata, and saves the provider so it loads on every startup.",
        input: ADD_PROVIDER_INPUT,
        async execute(input) {
          const result = await addManagedProvider(input as AddProviderParams)
          return { content: result.message }
        },
      })
    })

    await ctx.rpc.register(DynamicProviders, {
      providers: async () => {
        const providers = await ctx.provider.list()
        return { ids: [...new Set([...providers.data.map((p) => p.id as string), ...knownProviderIds()])] }
      },
      reload: async () => reloadModels(),
      addProvider: async (input) => {
        const result = await addManagedProvider(input as AddProviderParams)
        return { success: result.success, message: result.message }
      },
    })
  },
})
