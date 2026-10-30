export declare const DynamicProviders: {
    readonly id: "opencode-dynamic-custom-providers";
    readonly methods: {
        readonly providers: {
            readonly input: {
                readonly type: "object";
                readonly properties: {};
                readonly additionalProperties: false;
            };
            readonly output: {
                readonly type: "object";
                readonly properties: {
                    readonly ids: {
                        readonly type: "array";
                        readonly items: {
                            readonly type: "string";
                        };
                    };
                };
                readonly required: readonly ["ids"];
                readonly additionalProperties: false;
            };
        };
        readonly reload: {
            readonly input: {
                readonly type: "object";
                readonly properties: {};
                readonly additionalProperties: false;
            };
            readonly output: {
                readonly type: "object";
                readonly properties: {
                    readonly totalModels: {
                        readonly type: "number";
                    };
                    readonly failures: {
                        readonly type: "number";
                    };
                    readonly providerCount: {
                        readonly type: "number";
                    };
                    readonly warnings: {
                        readonly type: "array";
                        readonly items: {
                            readonly type: "string";
                        };
                    };
                    readonly errors: {
                        readonly type: "array";
                        readonly items: {
                            readonly type: "string";
                        };
                    };
                };
                readonly required: readonly ["totalModels", "failures", "providerCount", "warnings", "errors"];
                readonly additionalProperties: false;
            };
        };
        readonly addProvider: {
            readonly input: {
                readonly type: "object";
                readonly properties: {
                    readonly providerId: {
                        readonly type: "string";
                    };
                    readonly baseURL: {
                        readonly type: "string";
                    };
                    readonly apiKey: {
                        readonly type: "string";
                    };
                    readonly displayStyle: {
                        readonly type: "string";
                        readonly enum: readonly ["slug", "name"];
                    };
                    readonly overwrite: {
                        readonly type: "boolean";
                    };
                };
                readonly required: readonly ["providerId", "baseURL"];
                readonly additionalProperties: false;
            };
            readonly output: {
                readonly type: "object";
                readonly properties: {
                    readonly success: {
                        readonly type: "boolean";
                    };
                    readonly message: {
                        readonly type: "string";
                    };
                };
                readonly required: readonly ["success", "message"];
                readonly additionalProperties: false;
            };
        };
    };
    readonly events: {};
};
