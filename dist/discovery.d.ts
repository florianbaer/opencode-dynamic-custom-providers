export declare function normalizeModelId(id: string): string;
export declare function clearModelsDevCache(): void;
interface EndpointModelResponse {
    id: string;
    name?: string;
    context_length?: number;
    max_completion_tokens?: number;
    max_output_tokens?: number;
    max_model_len?: number;
    context_window?: number;
    input_cost?: number;
    output_cost?: number;
    capabilities?: {
        tool_choice?: boolean;
        function_calling?: boolean;
        reasoning?: boolean;
        vision?: boolean;
        temperature?: boolean;
        structured_output?: boolean;
    };
    supported_parameters?: string[];
}
export declare function fetchEndpointModels(baseURL: string, apiKey?: string, extraHeaders?: Record<string, string>): Promise<EndpointModelResponse[]>;
export interface EnrichedModel {
    name: string;
    family?: string;
    release_date?: string;
    status?: string;
    attachment?: boolean;
    reasoning?: boolean;
    temperature?: boolean;
    tool_call?: boolean;
    cost?: {
        input: number;
        output: number;
        cache_read?: number;
        cache_write?: number;
    };
    limit: {
        context: number;
        input?: number;
        output: number;
    };
    modalities?: {
        input: string[];
        output: string[];
    };
}
export declare function capOutputLimit(context: number, output: number): number;
export type DisplayStyle = "name" | "slug";
export declare function discoverAndEnrich(baseURL: string, apiKey?: string, displayStyle?: DisplayStyle, extraHeaders?: Record<string, string>): Promise<Record<string, EnrichedModel>>;
export {};
