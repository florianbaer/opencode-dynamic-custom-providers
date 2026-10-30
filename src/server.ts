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
    // Providers from the user's config, as first seen in the effective list.
    // Config is layered on after plugin transforms, so the transform can't
    // see them and has to add them itself once they have models.
    const configProviders = new Map<string, Provider.Info>()

    const configTargets = async (): Promise<DiscoveryTarget[]> => {
      const where = { location: { directory: ctx.location.directory } }
      const [providers, models] = await Promise.all([ctx.provider.list(where), ctx.model.list(where)])
      const counts = new Map<string, number>()
      for (const m of models.data) counts.set(m.providerID, (counts.get(m.providerID) ?? 0) + 1)

      const targets: DiscoveryTarget[] = []
      for (const info of providers.data as unknown as Provider.Info[]) {
        if (managed.has(info.id)) continue
        // Models we injected ourselves don't count as models from config.
        const ownModels = discovered.has(info.id) ? 0 : counts.get(info.id) ?? 0
        const target = targetFromProvider(info, ownModels, options)
        if (!target) continue
        targets.push(target)
        if (!configProviders.has(info.id)) configProviders.set(info.id, info)
      }
      return targets
    }

    const allTargets = async (): Promise<DiscoveryTarget[]> => [
      ...(await configTargets()),
      ...[...managed.values()].map(targetFromManaged),
    ]

    // Coalesces reloads, so each provider shows up as soon as it answers
    // without one slow endpoint holding back the rest.
    let reloading: Promise<void> | null = null
    let reloadAgain = false
    const scheduleReload = (): Promise<void> => {
      if (reloading) {
        reloadAgain = true
        return reloading
      }
      reloading = (async () => {
        do {
          reloadAgain = false
          await ctx.provider.reload()
        } while (reloadAgain)
      })().finally(() => {
        reloading = null
      })
      return reloading
    }

    const refresh = async (targets: DiscoveryTarget[], clearCache: boolean) => {
      const result = await reloadAllProviders(
        targets,
        discovered,
        (providerId, models) => {
          discovered.set(providerId, toModelInfos(providerId, models))
          void scheduleReload()
        },
        { clearCache },
      )
      if (reloading) await reloading
      for (const e of result.errors) console.warn(`[${PLUGIN_ID}] ${e}`)
      return result
    }

    await ctx.provider.transform((editor) => {
      for (const provider of managed.values()) {
        if (editor.get(provider.id)) editor.remove(provider.id)
        editor.add({ info: managedProviderInfo(provider), models: discovered.get(provider.id) ?? [] })
      }

      for (const [providerId, models] of discovered) {
        if (managed.has(providerId)) continue
        const record = editor.get(providerId)
        if (record) {
          if (!record.provider.package) {
            editor.update(providerId, (p) => {
              p.package = OPENAI_COMPATIBLE_PACKAGE
            })
          }
          editor.models.set(providerId, models)
          continue
        }
        const info = configProviders.get(providerId)
        if (info) {
          editor.add({ info: { ...info, package: info.package || OPENAI_COMPATIBLE_PACKAGE }, models })
        }
      }
    })

    const reloadModels = async () => refresh(await allTargets(), true)

    // Config providers aren't loaded yet while setup runs, so discovery is
    // driven by provider/config events. Each provider is discovered once;
    // later rounds go through refresh-models or /reload-models.
    const attempted = new Set<string>()
    let scanning = false
    let scanAgain = false
    const discoverNew = async () => {
      if (scanning) {
        scanAgain = true
        return
      }
      scanning = true
      try {
        do {
          scanAgain = false
          const pending = (await allTargets()).filter((t) => !t.hasModels && !attempted.has(t.id))
          if (pending.length === 0) continue
          for (const t of pending) attempted.add(t.id)
          await refresh(pending, false)
        } while (scanAgain)
      } catch (error) {
        console.warn(`[${PLUGIN_ID}] Discovery failed: ${sanitizeErrorMessage(error)}`)
      } finally {
        scanning = false
      }
    }

    const events = new AbortController()
    void (async () => {
      try {
        for await (const _ of ctx.event.subscribe({
          types: ["provider.updated", "config.updated"],
          signal: events.signal,
        })) {
          void discoverNew()
        }
      } catch (error) {
        if (!events.signal.aborted) {
          console.warn(`[${PLUGIN_ID}] Event stream failed: ${sanitizeErrorMessage(error)}`)
        }
      }
    })()
    setTimeout(() => void discoverNew(), 0)

    const knownProviderIds = () => new Set([...configProviders.keys(), ...managed.keys()])

    const addManagedProvider = async (params: AddProviderParams): Promise<AddProviderResult> => {
      const providers = await ctx.provider.list()
      const existing = new Set([...providers.data.map((p) => p.id as string), ...knownProviderIds()])
      const validationError = validateAddProviderParams(params, existing)
      if (validationError) return { success: false, modelCount: 0, message: validationError }

      const result = await addProvider(params)
      if (!result.success || !result.provider || !result.models) return result

      await ctx.storage.set(STORAGE_PREFIX + result.provider.id, result.provider as never)
      managed.set(result.provider.id, result.provider)
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

    return () => events.abort()
  },
})
