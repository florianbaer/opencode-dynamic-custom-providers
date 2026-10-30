import { isValidUrl } from "./security.js";
export const PLUGIN_ID = "opencode-dynamic-custom-providers";
// Runtime package OpenCode V2 uses for OpenAI-compatible endpoints.
export const OPENAI_COMPATIBLE_PACKAGE = "@opencode/ai/providers/openai-compatible";
export function envApiKey(providerId) {
    const envKey = `OPENCODE_LOCAL_${providerId.toUpperCase().replaceAll(/[^A-Z0-9]/g, "_")}_API_KEY`;
    return process.env[envKey];
}
function stringSetting(settings, key) {
    const value = settings?.[key];
    return typeof value === "string" && value ? value : undefined;
}
export function targetFromProvider(info, modelCount, options) {
    const settings = info.settings;
    const baseURL = stringSetting(settings, "baseURL");
    if (!baseURL || !isValidUrl(baseURL))
        return null;
    const providerOptions = options.providers?.[info.id] ?? {};
    return {
        id: info.id,
        baseURL,
        apiKey: stringSetting(settings, "apiKey") ?? envApiKey(info.id),
        headers: info.headers && Object.keys(info.headers).length > 0 ? { ...info.headers } : undefined,
        displayStyle: providerOptions.displayStyle ?? options.displayStyle ?? "slug",
        hasModels: modelCount > 0 && providerOptions.dynamic !== true,
    };
}
export function targetFromManaged(provider) {
    return {
        id: provider.id,
        baseURL: provider.baseURL,
        apiKey: provider.apiKey ?? envApiKey(provider.id),
        displayStyle: provider.displayStyle,
        hasModels: false,
    };
}
export function managedProviderInfo(provider) {
    return {
        id: provider.id,
        name: provider.name,
        activation: "enabled",
        package: OPENAI_COMPATIBLE_PACKAGE,
        settings: {
            baseURL: provider.baseURL,
            ...(provider.apiKey ? { apiKey: provider.apiKey } : {}),
        },
    };
}
const MODEL_STATUSES = new Set(["alpha", "beta", "deprecated", "active"]);
// Converts a discovered model to the V2 Model.Info shape.
export function toModelInfo(providerId, modelId, model) {
    const released = model.release_date ? Date.parse(model.release_date) : Number.NaN;
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
    };
}
export function toModelInfos(providerId, models) {
    return Object.entries(models).map(([id, model]) => toModelInfo(providerId, id, model));
}
