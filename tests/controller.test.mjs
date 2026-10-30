import "./setup.mjs"
import { test } from "node:test"
import assert from "node:assert"
import { createServer } from "node:http"
import { DiscoveryController } from "../src/controller.ts"
import { OPENAI_COMPATIBLE_PACKAGE } from "../src/types.ts"

async function modelsEndpoint(ids, { delay = 0 } = {}) {
  let requests = 0
  const server = createServer((_req, res) => {
    requests++
    setTimeout(() => {
      res.setHeader("content-type", "application/json")
      res.end(JSON.stringify({ data: ids.map((id) => ({ id })) }))
    }, delay)
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  return {
    baseURL: `http://127.0.0.1:${server.address().port}/v1`,
    requests: () => requests,
    close: () => server.close(),
  }
}

// A fake OpenCode host. Like the real one, catalog providers go through the
// plugin's transform, and config providers are layered on afterwards, so the
// transform never sees them.
function fakeHost({ catalog = [], config = [] } = {}) {
  let transform = () => {}
  let effective = new Map()
  const host = {
    reloads: 0,
    warnings: [],
    async listProviders() {
      return [...effective.values()].map((r) => r.provider)
    },
    async listModels() {
      return [...effective.values()].flatMap((r) => [...r.models.values()])
    },
    async reload() {
      host.reloads++
      replay()
    },
    warn(message) {
      host.warnings.push(message)
    },
    setTransform(fn) {
      transform = fn
      replay()
    },
    providers: () => effective,
  }
  const replay = () => {
    const state = new Map(
      catalog.map((r) => [r.provider.id, { provider: { ...r.provider }, models: new Map(r.models ?? []) }]),
    )
    transform({
      list: () => [...state.values()],
      get: (id) => state.get(id),
      add: ({ info, models }) => state.set(info.id, { provider: info, models: new Map(models.map((m) => [m.id, m])) }),
      update: (id, fn) => fn(state.get(id).provider),
      remove: (id) => state.delete(id),
      models: {
        set: (id, models) => {
          state.get(id).models = new Map(models.map((m) => [m.id, m]))
        },
      },
    })
    for (const c of config) {
      const existing = state.get(c.provider.id)
      state.set(c.provider.id, {
        provider: { ...existing?.provider, ...c.provider, package: existing?.provider.package || c.provider.package },
        models: c.models ? new Map(c.models) : (existing?.models ?? new Map()),
      })
    }
    effective = state
  }
  return host
}

function setup(hostOptions, options = {}, managed = []) {
  const host = fakeHost(hostOptions)
  const controller = new DiscoveryController(host, options, managed)
  host.setTransform((editor) => controller.applyTransform(editor))
  return { host, controller }
}

const configProvider = (id, baseURL, extra = {}) => ({
  provider: { id, name: id, activation: "enabled", package: "", settings: { baseURL }, ...extra },
})

test("discovers config providers and adds them with the openai-compatible package", async () => {
  const endpoint = await modelsEndpoint(["gpt-4o", "local-x"])
  try {
    const { host, controller } = setup({ config: [configProvider("local", endpoint.baseURL)] })
    await controller.discoverNew()

    const local = host.providers().get("local")
    assert.strictEqual(local.provider.package, OPENAI_COMPATIBLE_PACKAGE)
    assert.deepStrictEqual([...local.models.keys()], ["gpt-4o", "local-x"])
    assert.strictEqual(local.models.get("gpt-4o").limit.context, 128_000, "enriched from models.dev")
    assert.strictEqual(host.reloads >= 1, true)
  } finally {
    endpoint.close()
  }
})

test("discovers each provider only once automatically", async () => {
  const endpoint = await modelsEndpoint(["m"])
  try {
    const { controller } = setup({ config: [configProvider("local", endpoint.baseURL)] })
    await controller.discoverNew()
    await controller.discoverNew()
    assert.strictEqual(endpoint.requests(), 1)

    const result = await controller.reloadAll()
    assert.strictEqual(result.totalModels, 1)
    assert.strictEqual(endpoint.requests(), 2, "reloadAll rediscovers")
  } finally {
    endpoint.close()
  }
})

test("leaves config providers with their own models alone unless dynamic", async () => {
  const endpoint = await modelsEndpoint(["discovered"])
  const withModels = { ...configProvider("static", endpoint.baseURL), models: [["own", { id: "own", providerID: "static" }]] }
  try {
    let { controller } = setup({ config: [withModels] })
    await controller.discoverNew()
    assert.strictEqual(endpoint.requests(), 0)

    ;({ controller } = setup({ config: [withModels] }, { providers: { static: { dynamic: true } } }))
    await controller.discoverNew()
    assert.strictEqual(endpoint.requests(), 1)
  } finally {
    endpoint.close()
  }
})

test("never probes catalog providers unless opted in", async () => {
  const endpoint = await modelsEndpoint(["m"])
  try {
    const catalog = [
      {
        provider: {
          id: "perplexity",
          name: "Perplexity",
          activation: "auto",
          package: OPENAI_COMPATIBLE_PACKAGE,
          integrationID: "perplexity",
          settings: { baseURL: endpoint.baseURL },
        },
      },
    ]
    const { controller } = setup({ catalog })
    await controller.discoverNew()
    assert.strictEqual(endpoint.requests(), 0)
  } finally {
    endpoint.close()
  }
})

test("a slow endpoint doesn't hold back a fast one", async () => {
  const fast = await modelsEndpoint(["fast-model"])
  const slow = await modelsEndpoint(["slow-model"], { delay: 300 })
  try {
    const { host, controller } = setup({
      config: [configProvider("fast", fast.baseURL), configProvider("slow", slow.baseURL)],
    })
    const done = controller.discoverNew()
    await new Promise((resolve) => setTimeout(resolve, 150))
    assert.strictEqual(host.providers().get("fast").models.size, 1)
    assert.strictEqual(host.providers().get("slow").models.size, 0)
    await done
    assert.strictEqual(host.providers().get("slow").models.size, 1)
  } finally {
    fast.close()
    slow.close()
  }
})

test("restores managed providers and registers newly added ones", async () => {
  const endpoint = await modelsEndpoint(["m1", "m2"])
  try {
    const stored = { id: "stored", name: "stored", baseURL: endpoint.baseURL, displayStyle: "slug" }
    const { host, controller } = setup({}, {}, [stored])
    await controller.discoverNew()
    assert.deepStrictEqual([...host.providers().get("stored").models.keys()], ["m1", "m2"])
    assert.strictEqual(host.providers().get("stored").provider.activation, "enabled")

    await controller.addManaged(
      { id: "added", name: "added", baseURL: endpoint.baseURL, displayStyle: "slug" },
      { m3: { name: "m3", limit: { context: 8192, output: 4096 } } },
    )
    assert.deepStrictEqual([...host.providers().get("added").models.keys()], ["m3"])
    assert.deepStrictEqual([...(await controller.knownProviderIds())].sort(), ["added", "stored"])
  } finally {
    endpoint.close()
  }
})

test("reports endpoint failures as warnings instead of throwing", async () => {
  const { host, controller } = setup({ config: [configProvider("down", "http://127.0.0.1:9/v1")] })
  await controller.discoverNew()
  assert.strictEqual(host.warnings.length, 1)
  assert.match(host.warnings[0], /Failed to reload down/)
})

test("stops reloading after dispose", async () => {
  const endpoint = await modelsEndpoint(["m"])
  try {
    const { host, controller } = setup({ config: [configProvider("local", endpoint.baseURL)] })
    controller.dispose()
    await controller.discoverNew()
    assert.strictEqual(host.reloads, 0)
  } finally {
    endpoint.close()
  }
})
