import { test } from "node:test"
import assert from "node:assert"
import { createServer } from "node:http"
import {
  OPENAI_COMPATIBLE_PACKAGE,
  managedProviderInfo,
  targetFromProvider,
  toModelInfo,
} from "../dist/types.js"
import { reloadAllProviders, validateAddProviderParams } from "../dist/commands.js"

test("targetFromProvider reads baseURL, apiKey and headers from V2 provider info", () => {
  const target = targetFromProvider(
    {
      id: "my-proxy",
      name: "My Proxy",
      activation: "auto",
      package: OPENAI_COMPATIBLE_PACKAGE,
      settings: { baseURL: "https://api.proxy.com/v1", apiKey: "sk-test" },
      headers: { "X-Team": "a" },
    },
    0,
    {},
  )
  assert.deepStrictEqual(target, {
    id: "my-proxy",
    baseURL: "https://api.proxy.com/v1",
    apiKey: "sk-test",
    headers: { "X-Team": "a" },
    displayStyle: "slug",
    hasModels: false,
  })
})

test("targetFromProvider skips providers without a valid baseURL", () => {
  const info = { id: "anthropic", name: "Anthropic", activation: "auto", package: "x" }
  assert.strictEqual(targetFromProvider(info, 10, {}), null)
  assert.strictEqual(
    targetFromProvider({ ...info, settings: { baseURL: "not a url" } }, 0, {}),
    null,
  )
})

test("targetFromProvider honours per-provider plugin options", () => {
  const info = {
    id: "p",
    name: "p",
    activation: "auto",
    package: "",
    settings: { baseURL: "http://localhost:1234/v1" },
  }
  assert.strictEqual(targetFromProvider(info, 3, {}).hasModels, true)
  const target = targetFromProvider(info, 3, {
    displayStyle: "name",
    providers: { p: { dynamic: true } },
  })
  assert.strictEqual(target.hasModels, false)
  assert.strictEqual(target.displayStyle, "name")
})

test("targetFromProvider falls back to OPENCODE_LOCAL_<ID>_API_KEY", () => {
  process.env.OPENCODE_LOCAL_ENV_PROXY_API_KEY = "sk-env"
  try {
    const target = targetFromProvider(
      { id: "env-proxy", name: "e", activation: "auto", package: "", settings: { baseURL: "https://x.dev/v1" } },
      0,
      {},
    )
    assert.strictEqual(target.apiKey, "sk-env")
  } finally {
    delete process.env.OPENCODE_LOCAL_ENV_PROXY_API_KEY
  }
})

test("toModelInfo maps an enriched model to V2 Model.Info", () => {
  const info = toModelInfo("p", "gpt-4o", {
    name: "GPT-4o",
    family: "gpt",
    release_date: "2024-05-13",
    status: "active",
    tool_call: true,
    temperature: true,
    cost: { input: 2.5, output: 10, cache_read: 1.25 },
    limit: { context: 128_000, output: 16_384 },
    modalities: { input: ["text", "image"], output: ["text"] },
  })
  assert.deepStrictEqual(info, {
    id: "gpt-4o",
    modelID: "gpt-4o",
    providerID: "p",
    name: "GPT-4o",
    family: "gpt",
    capabilities: { tools: true, input: ["text", "image"], output: ["text"], temperature: true },
    variants: [],
    time: { released: Date.parse("2024-05-13") },
    cost: [{ input: 2.5, output: 10, cache: { read: 1.25, write: 0 } }],
    status: "active",
    enabled: true,
    limit: { context: 128_000, output: 16_384 },
  })
})

test("toModelInfo uses safe defaults for unknown models", () => {
  const info = toModelInfo("p", "mystery", { name: "mystery", status: "weird", limit: { context: 128_000, output: 4096 } })
  assert.deepStrictEqual(info.capabilities, { tools: false, input: ["text"], output: ["text"] })
  assert.deepStrictEqual(info.cost, [])
  assert.strictEqual(info.status, "active")
  assert.strictEqual(info.time.released, 0)
})

test("managedProviderInfo builds an enabled openai-compatible provider", () => {
  assert.deepStrictEqual(
    managedProviderInfo({ id: "m", name: "m", baseURL: "https://m.dev/v1", apiKey: "k", displayStyle: "slug" }),
    {
      id: "m",
      name: "m",
      activation: "enabled",
      package: OPENAI_COMPATIBLE_PACKAGE,
      settings: { baseURL: "https://m.dev/v1", apiKey: "k" },
    },
  )
})

test("validateAddProviderParams rejects duplicates unless overwrite is set", () => {
  const existing = new Set(["taken"])
  assert.match(validateAddProviderParams({ providerId: "taken", baseURL: "https://a.dev" }, existing), /already exists/)
  assert.strictEqual(
    validateAddProviderParams({ providerId: "taken", baseURL: "https://a.dev", overwrite: true }, existing),
    null,
  )
  assert.match(validateAddProviderParams({ providerId: "bad id", baseURL: "https://a.dev" }, existing), /Invalid Provider ID/)
  assert.match(validateAddProviderParams({ providerId: "ok", baseURL: "nope" }, existing), /Invalid Base URL/)
})

test("reloadAllProviders discovers models from an OpenAI-compatible endpoint", async () => {
  const seen = []
  const server = createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization, team: req.headers["x-team"] })
    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify({ data: [{ id: "local-model-x", context_length: 32_768 }] }))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address()

  try {
    const collected = {}
    const result = await reloadAllProviders(
      [
        {
          id: "local",
          baseURL: `http://127.0.0.1:${port}/v1`,
          apiKey: "sk-local",
          headers: { "X-Team": "a" },
          displayStyle: "slug",
          hasModels: false,
        },
        { id: "static", baseURL: `http://127.0.0.1:${port}/v1`, displayStyle: "slug", hasModels: true },
      ],
      new Map(),
      (id, models) => {
        collected[id] = models
      },
    )

    assert.strictEqual(result.providerCount, 1)
    assert.strictEqual(result.totalModels, 1)
    assert.strictEqual(result.failures, 0)
    assert.deepStrictEqual(Object.keys(collected), ["local"])
    assert.strictEqual(collected.local["local-model-x"].limit.context, 32_768)
    assert.deepStrictEqual(seen, [{ url: "/v1/models", auth: "Bearer sk-local", team: "a" }])
  } finally {
    server.close()
  }
})

test("reloadAllProviders reports endpoint failures without throwing", async () => {
  const server = createServer((_req, res) => {
    res.statusCode = 401
    res.end("bad key sk-secret123")
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address()

  try {
    const result = await reloadAllProviders(
      [{ id: "broken", baseURL: `http://127.0.0.1:${port}/v1`, displayStyle: "slug", hasModels: false }],
      new Map(),
      () => assert.fail("no models expected"),
    )
    assert.strictEqual(result.failures, 1)
    assert.match(result.errors[0], /HTTP 401/)
    assert.doesNotMatch(result.errors[0], /sk-secret123/)
  } finally {
    server.close()
  }
})
