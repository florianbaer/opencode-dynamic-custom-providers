import { discoverAndEnrich, clearModelsDevCache } from "./discovery.js";
import { isValidUrl, sanitizeErrorMessage } from "./security.js";
async function reloadOneProvider(target, hadModels) {
    const providerId = target.id;
    try {
        const models = await discoverAndEnrich(target.baseURL, target.apiKey, target.displayStyle, target.headers);
        const count = Object.keys(models).length;
        if (count > 0) {
            return { providerId, models };
        }
        if (hadModels) {
            return {
                providerId,
                models: null,
                warning: `${providerId} returned 0 models (keeping previous models). Check endpoint status.`,
            };
        }
        return { providerId, models: null };
    }
    catch (error) {
        return {
            providerId,
            models: null,
            error: `Failed to reload ${providerId}: ${sanitizeErrorMessage(error)}`,
        };
    }
}
// Discovers models for every target that has no models of its own.
// `previous` holds the models discovered last time, so a provider that
// suddenly returns nothing keeps them.
export async function reloadAllProviders(targets, previous, onModels, options = {}) {
    const dynamicTargets = targets.filter((t) => !t.hasModels);
    const result = {
        totalModels: 0,
        failures: 0,
        providerCount: dynamicTargets.length,
        warnings: [],
        errors: [],
    };
    if (dynamicTargets.length === 0)
        return result;
    if (options.clearCache)
        clearModelsDevCache();
    const outcomes = await Promise.allSettled(dynamicTargets.map((t) => reloadOneProvider(t, previous.has(t.id))));
    for (const outcome of outcomes) {
        if (outcome.status === "rejected") {
            result.failures++;
            result.errors.push(`Unexpected error: ${sanitizeErrorMessage(outcome.reason)}`);
            continue;
        }
        const { providerId, models, warning, error } = outcome.value;
        if (error) {
            result.failures++;
            result.errors.push(error);
        }
        else if (warning) {
            result.warnings.push(warning);
        }
        if (models) {
            onModels(providerId, models);
            result.totalModels += Object.keys(models).length;
        }
    }
    return result;
}
export function formatReloadResult(result) {
    if (result.providerCount === 0) {
        return "No dynamic providers configured. Add a provider with a baseURL first.";
    }
    const lines = [];
    if (result.failures === 0) {
        lines.push(`Reloaded ${result.totalModels} model(s) from ${result.providerCount} provider(s).`);
    }
    else {
        lines.push(`Reloaded ${result.totalModels} model(s) with ${result.failures} failure(s).`);
    }
    for (const w of result.warnings)
        lines.push(`Warning: ${w}`);
    for (const e of result.errors)
        lines.push(`Error: ${e}`);
    return lines.join("\n");
}
export function validateProviderId(providerId) {
    if (!/^[a-zA-Z0-9_-]+$/.test(providerId)) {
        return "Invalid Provider ID. Use alphanumeric, hyphens, or underscores only.";
    }
    return null;
}
export function validateAddProviderParams(params, existingProviderIds) {
    const idError = validateProviderId(params.providerId);
    if (idError)
        return idError;
    if (!isValidUrl(params.baseURL)) {
        return "Invalid Base URL. Please enter a full URL (including https://).";
    }
    if (existingProviderIds.has(params.providerId) && !params.overwrite) {
        return `A provider with ID '${params.providerId}' already exists. Set overwrite to true to replace it.`;
    }
    return null;
}
export async function addProvider(params) {
    const displayStyle = params.displayStyle ?? "slug";
    const baseURL = params.baseURL.trim().replace(/\/+$/, "");
    try {
        const models = await discoverAndEnrich(baseURL, params.apiKey, displayStyle);
        const modelCount = Object.keys(models).length;
        if (modelCount === 0) {
            return {
                success: false,
                modelCount: 0,
                message: "No models found at the given endpoint. Provider not added.",
            };
        }
        const provider = {
            id: params.providerId,
            name: params.providerId,
            baseURL,
            ...(params.apiKey ? { apiKey: params.apiKey } : {}),
            displayStyle,
        };
        return {
            success: true,
            modelCount,
            message: `Provider '${params.providerId}' added with ${modelCount} model(s).`,
            provider,
            models,
        };
    }
    catch (error) {
        return {
            success: false,
            modelCount: 0,
            message: `Failed to discover models: ${sanitizeErrorMessage(error)}`,
        };
    }
}
