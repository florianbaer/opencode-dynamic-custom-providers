// Contract between the server part (which owns discovery and storage) and the
// TUI part (which only collects input). Plain JSON Schema keeps this module
// free of runtime imports.
export const DynamicProviders = {
    id: "opencode-dynamic-custom-providers",
    methods: {
        providers: {
            input: { type: "object", properties: {}, additionalProperties: false },
            output: {
                type: "object",
                properties: { ids: { type: "array", items: { type: "string" } } },
                required: ["ids"],
                additionalProperties: false,
            },
        },
        reload: {
            input: { type: "object", properties: {}, additionalProperties: false },
            output: {
                type: "object",
                properties: {
                    totalModels: { type: "number" },
                    failures: { type: "number" },
                    providerCount: { type: "number" },
                    warnings: { type: "array", items: { type: "string" } },
                    errors: { type: "array", items: { type: "string" } },
                },
                required: ["totalModels", "failures", "providerCount", "warnings", "errors"],
                additionalProperties: false,
            },
        },
        addProvider: {
            input: {
                type: "object",
                properties: {
                    providerId: { type: "string" },
                    baseURL: { type: "string" },
                    apiKey: { type: "string" },
                    displayStyle: { type: "string", enum: ["slug", "name"] },
                    overwrite: { type: "boolean" },
                },
                required: ["providerId", "baseURL"],
                additionalProperties: false,
            },
            output: {
                type: "object",
                properties: {
                    success: { type: "boolean" },
                    message: { type: "string" },
                },
                required: ["success", "message"],
                additionalProperties: false,
            },
        },
    },
    events: {},
};
