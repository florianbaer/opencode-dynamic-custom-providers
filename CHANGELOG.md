# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- `opencode plugin add git+https://…` failed in git dependency preparation; the package now ships its TypeScript sources and has no build script
- Providers defined in config were never discovered, because config is layered on after plugin transforms; catalog providers were probed instead. Discovery now follows provider/config events, picks up providers added to the config at runtime, and skips catalog providers unless `dynamic: true`
- Each provider's models now appear as soon as its endpoint answers instead of after the slowest one
- A config provider without a `package` now gets the openai-compatible package

### Changed
- Discovery state moved into a testable `DiscoveryController`; the plugin unsubscribes and stops reloading on unload
- No build step: tests run on the TypeScript sources with Node's type stripping, `tsc` only typechecks (stricter settings incl. `noUncheckedIndexedAccess`)
- Hermetic test suite with a fake OpenCode host, plus GitHub Actions CI

## [3.0.0] - 2026-10-30

### Changed
- **Breaking:** ported to the OpenCode V2 plugin API (`@opencode/plugin`). OpenCode V1 users should stay on 2.x
- Discovered models are injected with `ctx.provider.transform` instead of the V1 `config` hook, and discovery runs in the background rather than blocking startup
- Providers are read from V2 config (`providers.<id>.settings.baseURL`, `settings.apiKey`, `headers`)
- `dynamic` and `displayStyle` moved from the provider config to the plugin options (`options.providers.<id>`)
- Providers added with `/add-provider` or the `add-provider` tool are saved in plugin storage, because V2 plugins can't write config
- The TUI commands call the server part over a typed RPC contract (exported as `opencode-dynamic-custom-providers/rpc`)
- Install with `opencode plugin add opencode-dynamic-custom-providers`

## [2.2.0] - 2026-05-23

### Added
- `add-provider` server tool for web/desktop provider setup (no TUI required)
- `refresh-models` server tool now performs full live re-discovery and config update (previously only cleared cache)

### Changed
- Extracted shared command logic into `src/commands.ts` to deduplicate between TUI commands and server tools
- Refactored TUI `/add-provider` and `/reload-models` to use shared logic

## [2.0.0] - 2026-05-21

### Added
- Automatic model discovery from any provider with a `baseURL` at startup
- [models.dev](https://models.dev) metadata enrichment (context windows, costs, capabilities, modalities)
- `/add-provider` TUI slash command for interactive provider setup
- `/reload-models` TUI slash command for in-session model re-discovery
- `refresh-models` server tool to clear the models.dev metadata cache
- `displayStyle` option to control model display names (`slug` vs `name`)
- Security: URL validation, model ID sanitization, error message redaction
- Stale cache fallback when models.dev is unreachable
- Environment variable support for API keys (`OPENCODE_LOCAL_<ID>_API_KEY`)
