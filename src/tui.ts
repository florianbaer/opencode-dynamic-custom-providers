import { Plugin } from "@opencode/plugin/tui"
import type { DisplayStyle } from "./discovery.ts"
import { validateProviderId, type ReloadResult } from "./commands.ts"
import { DynamicProviders } from "./rpc.ts"
import { isValidUrl } from "./security.ts"
import { PLUGIN_ID } from "./types.ts"

export default Plugin.define({
  id: `${PLUGIN_ID}.tui`,
  setup(context) {
    const server = context.client.rpc(DynamicProviders)
    const toast = context.ui.toast
    const dialog = context.ui.dialog

    const reloadModels = async () => {
      toast.show({ message: "Reloading models from dynamic providers...", variant: "info" })

      const result = (await server.reload({})) as ReloadResult

      if (result.providerCount === 0) {
        toast.show({ message: "No dynamic providers configured.", variant: "warning" })
        return
      }
      for (const w of result.warnings) toast.show({ message: w, variant: "warning" })
      for (const e of result.errors) toast.show({ message: e, variant: "error" })

      if (result.failures === 0) {
        toast.show({
          message: `Reloaded ${result.totalModels} model(s) from ${result.providerCount} provider(s).`,
          variant: "success",
        })
      } else if (result.totalModels > 0) {
        toast.show({
          message: `Reloaded ${result.totalModels} model(s) with ${result.failures} failure(s). Check provider URLs/keys.`,
          variant: "warning",
        })
      }
    }

    const addProviderWizard = async () => {
      const rawProviderId = await dialog.prompt({
        title: "Provider ID",
        placeholder: "e.g., my-proxy (alphanumeric only)",
      })
      if (!rawProviderId) return

      const providerId = rawProviderId.trim()
      const idError = validateProviderId(providerId)
      if (idError) {
        toast.show({ message: idError, variant: "error" })
        return
      }

      const { ids } = (await server.providers({})) as { ids: string[] }
      let overwrite = false
      if (ids.includes(providerId)) {
        overwrite = (await dialog.confirm({
          title: "Provider already exists",
          message: `A provider with ID '${providerId}' already exists. Overwrite it?`,
        })) === true
        if (!overwrite) return
      }

      const rawBaseURL = await dialog.prompt({ title: "Base URL", placeholder: "https://api.example.com/v1" })
      if (!rawBaseURL) return
      const baseURL = rawBaseURL.trim()
      if (!isValidUrl(baseURL)) {
        toast.show({ message: "Invalid Base URL. Please enter a full URL (including https://).", variant: "error" })
        return
      }

      const rawApiKey = await dialog.prompt({ title: "API Key (Optional)", placeholder: "sk-..." })
      const apiKey = rawApiKey?.trim() || undefined

      const displayStyle = await dialog.select<DisplayStyle>({
        title: "Model Display Names",
        options: [
          { title: "Full Slug", value: "slug", description: "vertex/gemini-3.1-pro (best for proxies)" },
          { title: "Friendly Name", value: "name", description: "Gemini 3.1 Pro (may be ambiguous)" },
        ],
      })
      if (!displayStyle) return

      toast.show({ message: `Discovering models from ${baseURL}...`, variant: "info" })

      const result = (await server.addProvider({
        providerId,
        baseURL,
        displayStyle,
        overwrite,
        ...(apiKey ? { apiKey } : {}),
      })) as { success: boolean; message: string }

      toast.show({ message: result.message, variant: result.success ? "success" : "warning" })
    }

    const handleError = (error: unknown) => {
      toast.show({ message: error instanceof Error ? error.message : String(error), variant: "error" })
    }

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: `${PLUGIN_ID}.reload-models`,
          title: "Reload Models",
          description: "Re-discover models from all dynamic providers without restarting",
          palette: true,
          slash: { name: "reload-models", aliases: ["refresh-models"] },
          run: () => reloadModels().catch(handleError),
        },
        {
          id: `${PLUGIN_ID}.add-provider`,
          title: "Add Provider",
          description: "Add a new OpenAI-compatible custom provider with dynamic model discovery",
          palette: true,
          slash: { name: "add-provider" },
          run: () => addProviderWizard().catch(handleError),
        },
      ],
    }))
  },
})
