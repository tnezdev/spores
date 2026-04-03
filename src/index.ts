export type {
  Memory,
  MemoryTier,
  RecallQuery,
  RecallResult,
  DreamResult,
  SporesConfig,
} from "./types.js"

export type { MemoryAdapter, AdapterCapabilities } from "./memory/adapter.js"
export { FilesystemAdapter } from "./memory/filesystem.js"
export { loadConfig } from "./config.js"
