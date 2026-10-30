import type { Model, Plugin, Provider } from "@opencode/plugin"
import { reloadAllProviders, type ReloadResult } from "./commands.ts"
import type { EnrichedModel } from "./discovery.ts"
import { sanitizeErrorMessage } from "./security.ts"
import {
  OPENAI_COMPATIBLE_PACKAGE,
  managedProviderInfo,
  targetFromManaged,
  targetFromProvider,
  toModelInfos,
  type DiscoveryTarget,
  type ManagedProvider,
  type PluginOptions,
} from "./types.ts"

type ProviderEditor = Parameters<Parameters<Plugin.Context["provider"]["transform"]>[0]>[0]

// The parts of the OpenCode plugin context the controller needs. Kept small
// so tests can drive the controller with a fake host.
export interface DiscoveryHost {
  /** Effective providers for this location, including ones from config. */
  listProviders(): Promise<readonly Provider.Info[]>
  /** Effective models for this location. */
  listModels(): Promise<readonly { readonly providerID: string }[]>
  /** Replays provider transforms. */
  reload(): Promise<void>
  warn(message: string): void
}

// Owns discovery state. Provider transforms must be synchronous, so models
// are discovered outside them and `applyTransform` only replays the results.
export class DiscoveryController {
  readonly #host: DiscoveryHost
  readonly #options: PluginOptions
  readonly #managed: Map<string, ManagedProvider>
  readonly #discovered = new Map<string, Model.Info[]>()
  // Config providers are layered on after plugin transforms, so the editor
  // never lists them. Remember them from the provider API so the transform
  // can add them once they have models.
  readonly #configProviders = new Map<string, Provider.Info>()
  // Providers discovered automatically at least once; later rounds only run
  // on an explicit reload.
  readonly #attempted = new Set<string>()

  #scanning = false
  #scanAgain = false
  #reloading: Promise<void> | null = null
  #reloadAgain = false
  #disposed = false

  constructor(host: DiscoveryHost, options: PluginOptions, managed: Iterable<ManagedProvider>) {
    this.#host = host
    this.#options = options
    this.#managed = new Map([...managed].map((p) => [p.id, p]))
  }

  applyTransform(editor: ProviderEditor): void {
    for (const provider of this.#managed.values()) {
      if (editor.get(provider.id)) editor.remove(provider.id)
      editor.add({ info: managedProviderInfo(provider), models: this.#discovered.get(provider.id) ?? [] })
    }

    for (const [providerId, models] of this.#discovered) {
      if (this.#managed.has(providerId)) continue
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
      const info = this.#configProviders.get(providerId)
      if (info) {
        editor.add({ info: { ...info, package: info.package || OPENAI_COMPATIBLE_PACKAGE }, models })
      }
    }
  }

  /** Discovers every eligible provider that hasn't been discovered yet. Concurrent calls coalesce. */
  async discoverNew(): Promise<void> {
    if (this.#scanning) {
      this.#scanAgain = true
      return
    }
    this.#scanning = true
    try {
      do {
        this.#scanAgain = false
        const pending = (await this.#targets()).filter((t) => !t.hasModels && !this.#attempted.has(t.id))
        if (pending.length === 0) continue
        for (const t of pending) this.#attempted.add(t.id)
        await this.#refresh(pending, false)
      } while (this.#scanAgain && !this.#disposed)
    } catch (error) {
      this.#host.warn(`Discovery failed: ${sanitizeErrorMessage(error)}`)
    } finally {
      this.#scanning = false
    }
  }

  /** Rediscovers every eligible provider with a fresh models.dev catalog. */
  async reloadAll(): Promise<ReloadResult> {
    return this.#refresh(await this.#targets(), true)
  }

  async addManaged(provider: ManagedProvider, models: Record<string, EnrichedModel>): Promise<void> {
    this.#managed.set(provider.id, provider)
    this.#attempted.add(provider.id)
    this.#discovered.set(provider.id, toModelInfos(provider.id, models))
    await this.#scheduleReload()
  }

  async knownProviderIds(): Promise<Set<string>> {
    const providers = await this.#host.listProviders()
    return new Set([...providers.map((p) => p.id as string), ...this.#managed.keys()])
  }

  dispose(): void {
    this.#disposed = true
  }

  async #targets(): Promise<DiscoveryTarget[]> {
    const [providers, models] = await Promise.all([this.#host.listProviders(), this.#host.listModels()])
    const counts = new Map<string, number>()
    for (const m of models) counts.set(m.providerID, (counts.get(m.providerID) ?? 0) + 1)

    const targets: DiscoveryTarget[] = []
    for (const info of providers) {
      if (this.#managed.has(info.id)) continue
      // Models we injected ourselves don't count as models from config.
      const ownModels = this.#discovered.has(info.id) ? 0 : (counts.get(info.id) ?? 0)
      const target = targetFromProvider(info, ownModels, this.#options)
      if (!target) continue
      targets.push(target)
      if (!this.#configProviders.has(info.id)) this.#configProviders.set(info.id, info)
    }
    for (const provider of this.#managed.values()) targets.push(targetFromManaged(provider))
    return targets
  }

  async #refresh(targets: DiscoveryTarget[], clearCache: boolean): Promise<ReloadResult> {
    const result = await reloadAllProviders(
      targets,
      this.#discovered,
      (providerId, models) => {
        this.#discovered.set(providerId, toModelInfos(providerId, models))
        void this.#scheduleReload()
      },
      { clearCache },
    )
    if (this.#reloading) await this.#reloading
    for (const e of result.errors) this.#host.warn(e)
    return result
  }

  // Coalesces reloads, so each provider shows up as soon as its endpoint
  // answers without one slow endpoint holding back the rest.
  #scheduleReload(): Promise<void> {
    if (this.#disposed) return Promise.resolve()
    if (this.#reloading) {
      this.#reloadAgain = true
      return this.#reloading
    }
    this.#reloading = (async () => {
      do {
        this.#reloadAgain = false
        await this.#host.reload()
      } while (this.#reloadAgain && !this.#disposed)
    })()
      .catch((error) => this.#host.warn(`Reload failed: ${sanitizeErrorMessage(error)}`))
      .finally(() => {
        this.#reloading = null
      })
    return this.#reloading
  }
}
