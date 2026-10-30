// Makes the tests hermetic: models.dev is served from a fixture and the
// catalog cache is written to a throwaway HOME. Import this before src/.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-test-"))

export const MODELS_DEV = {
  openai: {
    id: "openai",
    name: "OpenAI",
    models: {
      "gpt-4o": {
        id: "gpt-4o",
        name: "GPT-4o",
        family: "gpt",
        release_date: "2024-05-13",
        attachment: true,
        reasoning: false,
        temperature: true,
        tool_call: true,
        cost: { input: 2.5, output: 10, cache_read: 1.25 },
        limit: { context: 128_000, output: 16_384 },
        modalities: { input: ["text", "image"], output: ["text"] },
      },
    },
  },
}

const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  if (url === "https://models.dev/api.json") {
    return new Response(JSON.stringify(MODELS_DEV), { headers: { "content-type": "application/json" } })
  }
  return realFetch(input, init)
}
