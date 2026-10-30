import { type DisplayStyle, type EnrichedModel } from "./discovery.js";
import type { DiscoveryTarget, ManagedProvider } from "./types.js";
export interface ReloadResult {
    totalModels: number;
    failures: number;
    providerCount: number;
    warnings: string[];
    errors: string[];
}
export declare function reloadAllProviders(targets: DiscoveryTarget[], previous: ReadonlyMap<string, unknown>, onModels: (providerId: string, models: Record<string, EnrichedModel>) => void, options?: {
    clearCache?: boolean;
}): Promise<ReloadResult>;
export declare function formatReloadResult(result: ReloadResult): string;
export interface AddProviderParams {
    providerId: string;
    baseURL: string;
    apiKey?: string;
    displayStyle?: DisplayStyle;
    overwrite?: boolean;
}
export interface AddProviderResult {
    success: boolean;
    modelCount: number;
    message: string;
    provider?: ManagedProvider;
    models?: Record<string, EnrichedModel>;
}
export declare function validateProviderId(providerId: string): string | null;
export declare function validateAddProviderParams(params: AddProviderParams, existingProviderIds: ReadonlySet<string>): string | null;
export declare function addProvider(params: AddProviderParams): Promise<AddProviderResult>;
