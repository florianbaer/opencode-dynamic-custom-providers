# OpenCode Dynamic Custom Providers

An [OpenCode V2](https://opencode.ai/v2/docs/) plugin that discovers models from OpenAI-compatible providers and adds metadata from [models.dev](https://models.dev).

> **OpenCode V1?** Version 3.x supports only OpenCode V2. On OpenCode V1 (`1.x`), stay on `opencode-dynamic-custom-providers@2`.

## Installation

```bash
opencode plugin add opencode-dynamic-custom-providers
```

That's all. The package has a server part, which handles discovery, tools and storage, and a TUI part, which adds the slash commands. OpenCode loads both from the one entry.

### Alternatives

Install straight from GitHub:

```bash
opencode plugin add git+https://github.com/jhabr/opencode-dynamic-custom-providers.git
```

Or add it to `opencode.jsonc` by hand:

```jsonc
{
  "plugins": ["opencode-dynamic-custom-providers"]
}
```

## Features

### 1. Automatic model discovery
On every startup the server plugin fetches `/models` from each provider you configured with a `settings.baseURL`. Discovery runs in the background, so it doesn't block startup. Models show up as soon as each endpoint answers. When the config changes and a new provider appears, the plugin discovers its models too.

### 2. models.dev metadata enrichment
Each discovered model is matched against the [models.dev](https://models.dev) catalog. A match adds the model's context window, output limit, cost, tool calling and temperature support, and input/output modalities.

### 3. `/add-provider` slash command (TUI)
An interactive wizard that adds a provider:
- Prompts for a provider ID, base URL, API key and display style
- Validates the input and checks for duplicates
- Discovers models to confirm the endpoint works before saving

### 4. `/reload-models` slash command (TUI)
Re-discovers models from every dynamic provider without restarting OpenCode. It is also available as `/refresh-models`.

### 5. `add-provider` and `refresh-models` agent tools
Server-side tools the agent can call from any client (TUI, web or desktop). For example: *"Add an OpenAI-compatible provider called my-proxy at https://api.proxy.com/v1 with API key sk-..."*

## Configuration

### Adding a provider in config
Add a provider with a `settings.baseURL`, and its models are discovered automatically:

```jsonc
{
  "providers": {
    "my-proxy": {
      "name": "My Proxy",
      "package": "@opencode/ai/providers/openai-compatible",
      "settings": {
        "baseURL": "https://api.proxy.com/v1"
      }
    }
  }
}
```

If you leave out `package`, the plugin sets `@opencode/ai/providers/openai-compatible`. Extra request headers in `headers` are also sent on the discovery request.

### Providers added with `/add-provider` or the tool
V2 plugins can't write `opencode.json`. The plugin saves these providers in its own plugin storage instead, and restores them on every startup.

### Plugin options
V2 config only accepts its own keys under `providers`. Settings that belong to this plugin (the V1 `dynamic` and `displayStyle` keys) therefore go in the plugin options:

```jsonc
{
  "plugins": [
    {
      "package": "opencode-dynamic-custom-providers",
      "options": {
        // Default for every provider: "slug" (full model ID) or "name" (friendly name)
        "displayStyle": "slug",
        "providers": {
          // Merge discovered models even though this provider defines its own
          "my-proxy": { "dynamic": true, "displayStyle": "name" }
        }
      }
    }
  ]
}
```

### API keys
The discovery request authenticates with, in order:

1. `settings.apiKey` in the provider config, or the key entered in `/add-provider`
2. The environment variable `OPENCODE_LOCAL_<PROVIDER_ID>_API_KEY`, for example:
   ```bash
   export OPENCODE_LOCAL_MY_PROXY_API_KEY=sk-...
   ```

A key entered in `/add-provider` is stored in the plugin's storage and passed to the provider as `settings.apiKey`.

## Discovery trigger

A provider you define under `providers` is eligible for discovery when it has a valid `settings.baseURL` and either:
- has no `models` of its own in config, **or**
- has `"dynamic": true` in the plugin options

OpenCode's built-in catalog providers (such as `openai` or `perplexity`) are never probed unless you set `"dynamic": true` for them in the plugin options.

## Migrating from V1 (2.x)

| V1 (`opencode.json`) | V2 |
| --- | --- |
| `"plugin": ["opencode-dynamic-custom-providers"]` | `opencode plugin add opencode-dynamic-custom-providers` |
| `provider.<id>` | `providers.<id>` |
| `options.baseURL` / `options.apiKey` | `settings.baseURL` / `settings.apiKey` |
| `options.headers` | `headers` |
| `npm: "@ai-sdk/openai-compatible"` | `package: "@opencode/ai/providers/openai-compatible"` (set automatically) |
| `dynamic`, `displayStyle` on the provider | plugin options `providers.<id>.dynamic` / `.displayStyle` |

Providers that V1's `/add-provider` wrote into `opencode.json` include a static `models` list. After you migrate the config, either delete that list or set `"dynamic": true` for the provider in the plugin options, so its models keep refreshing.

## Limitations
- **models.dev coverage**: models missing from the catalog get defaults: a 128k context window, a 4096-token output limit, text-only modalities and no tool calling.
- **Reasoning variants**: V2 builds reasoning-effort variants from config. Discovered models don't get variants yet.
- **Capability detection**: capabilities the endpoint reports (`supported_parameters`, `capabilities`) are merged with models.dev data. Neither source is complete for every proxy.

## Development

```bash
git clone https://github.com/jhabr/opencode-dynamic-custom-providers
cd opencode-dynamic-custom-providers
npm install
npm run check   # typecheck + tests
```

There's no build step. OpenCode loads the TypeScript in `src/` directly, and the tests run on the same sources through Node's built-in type stripping (Node 22.18+). The tests are hermetic: models.dev is served from a fixture and nothing is written outside a temporary directory. CI runs `npm run check` on every push and pull request.

| File | Role |
| --- | --- |
| `src/server.ts` | Server part: wires the controller, tools and RPC into OpenCode |
| `src/controller.ts` | Discovery state; reacts to provider/config events and feeds the provider transform |
| `src/discovery.ts` | `/models` fetching and models.dev enrichment |
| `src/commands.ts` | Reload and add-provider logic shared by tools, RPC and TUI |
| `src/tui.ts` | TUI part: `/add-provider` and `/reload-models` |
| `src/rpc.ts` | RPC contract between the TUI and server parts |

To try a local checkout, add its path to `plugins`:

```jsonc
{
  "plugins": ["/path/to/opencode-dynamic-custom-providers"]
}
```
