import { Plugin, type Provider } from "@opencode/plugin"
import {
  formatReloadResult,
  addProvider,
  validateAddProviderParams,
  type AddProviderParams,
  type AddProviderResult,
} from "./commands.ts"
import { DiscoveryController } from "./controller.ts"
import { DynamicProviders } from "./rpc.ts"
import { sanitizeErrorMessage } from "./security.ts"
import { PLUGIN_ID, type ManagedProvider, type PluginOptions } from "./types.ts"

export { DynamicProviders } from "./rpc.ts"
export type { ManagedProvider, PluginOptions, ProviderOptions } from "./types.ts"

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
    const warn = (message: string) => console.warn(`[${PLUGIN_ID}] ${message}`)
    const where = { location: { directory: ctx.location.directory } }

    const managed: ManagedProvider[] = []
    let after: string | undefined
    do {
      const page = await ctx.storage.scan({ prefix: STORAGE_PREFIX, after })
      for (const entry of page.entries) {
        const provider = entry.value as unknown as ManagedProvider
        if (provider?.id && provider.baseURL) managed.push(provider)
      }
      after = page.next
    } while (after)

    const controller = new DiscoveryController(
      {
        listProviders: async () => (await ctx.provider.list(where)).data as unknown as Provider.Info[],
        listModels: async () => (await ctx.model.list(where)).data,
        reload: () => ctx.provider.reload(),
        warn,
      },
      options,
      managed,
    )

    await ctx.provider.transform((editor) => controller.applyTransform(editor))

    const addManagedProvider = async (params: AddProviderParams): Promise<AddProviderResult> => {
      const validationError = validateAddProviderParams(params, await controller.knownProviderIds())
      if (validationError) return { success: false, modelCount: 0, message: validationError }

      const result = await addProvider(params)
      if (!result.success || !result.provider || !result.models) return result

      await ctx.storage.set(STORAGE_PREFIX + result.provider.id, result.provider as never)
      await controller.addManaged(result.provider, result.models)
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
          return { content: formatReloadResult(await controller.reloadAll()) }
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
      providers: async () => ({ ids: [...(await controller.knownProviderIds())] }),
      reload: () => controller.reloadAll(),
      addProvider: async (input) => {
        const result = await addManagedProvider(input as AddProviderParams)
        return { success: result.success, message: result.message }
      },
    })

    // Config providers aren't loaded yet while setup runs, so discovery is
    // driven by provider and config events, which also catch providers added
    // to the config later.
    const events = new AbortController()
    void (async () => {
      try {
        for await (const _ of ctx.event.subscribe({
          types: ["provider.updated", "config.updated"],
          signal: events.signal,
        })) {
          void controller.discoverNew()
        }
      } catch (error) {
        if (!events.signal.aborted) warn(`Event stream failed: ${sanitizeErrorMessage(error)}`)
      }
    })()
    const initial = setTimeout(() => void controller.discoverNew(), 0)

    return () => {
      clearTimeout(initial)
      events.abort()
      controller.dispose()
    }
  },
})
