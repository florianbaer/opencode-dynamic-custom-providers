import type { Model, Provider } from "@opencode/plugin";
import type { DisplayStyle, EnrichedModel } from "./discovery.js";
export declare const PLUGIN_ID = "opencode-dynamic-custom-providers";
export declare const OPENAI_COMPATIBLE_PACKAGE = "@opencode/ai/providers/openai-compatible";
export interface ProviderOptions {
    dynamic?: boolean;
    displayStyle?: DisplayStyle;
}
export interface PluginOptions {
    displayStyle?: DisplayStyle;
    providers?: Record<string, ProviderOptions>;
}
export interface ManagedProvider {
    id: string;
    name: string;
    baseURL: string;
    apiKey?: string;
    displayStyle: DisplayStyle;
}
export interface DiscoveryTarget {
    id: string;
    baseURL: string;
    apiKey?: string;
    headers?: Record<string, string>;
    displayStyle: DisplayStyle;
    hasModels: boolean;
}
export declare function envApiKey(providerId: string): string | undefined;
export declare function targetFromProvider(info: Provider.Info, modelCount: number, options: PluginOptions): DiscoveryTarget | null;
export declare function targetFromManaged(provider: ManagedProvider): DiscoveryTarget;
export declare function managedProviderInfo(provider: ManagedProvider): Provider.Info;
export declare function toModelInfo(providerId: string, modelId: string, model: EnrichedModel): Model.Info;
export declare function toModelInfos(providerId: string, models: Record<string, EnrichedModel>): Model.Info[];
