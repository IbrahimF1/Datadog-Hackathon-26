import dotenv from "dotenv";

dotenv.config();

const num = (v: string | undefined, fallback: number): number => {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};

const MINUTE = 60_000;
const SECOND = 1_000;

export const config = {
  port: num(process.env.PORT, 3000),

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
    model: process.env.ANTHROPIC_MODEL ?? "claude-opus-4-7",
  },

  nimble: {
    baseUrl:
      process.env.NIMBLE_BASE_URL ??
      "https://api.webit.live/api/v1/realtime/serp",
    authHeader: process.env.NIMBLE_AUTH_HEADER ?? "",
    username: process.env.NIMBLE_USERNAME ?? "",
    password: process.env.NIMBLE_PASSWORD ?? "",
    apiKey: process.env.NIMBLE_API_KEY ?? "",
    searchEngine: process.env.NIMBLE_SEARCH_ENGINE ?? "google_search",
  },

  datadog: {
    enabled: (process.env.DD_LLMOBS_ENABLED ?? "0") !== "0",
    mlApp: process.env.DD_LLMOBS_ML_APP ?? "peercode",
    apiKey: process.env.DD_API_KEY ?? "",
    site: process.env.DD_SITE ?? "datadoghq.com",
    agentless: (process.env.DD_LLMOBS_AGENTLESS_ENABLED ?? "1") !== "0",
  },

  clickhouse: {
    // Cloud-only: set CLICKHOUSE_URL to the HTTPS endpoint (e.g.
    // https://<id>.<region>.clickhouse.cloud:8443). No local fallback.
    url: process.env.CLICKHOUSE_URL ?? "",
    username: process.env.CLICKHOUSE_USER ?? "default",
    password: process.env.CLICKHOUSE_PASSWORD ?? "",
    database: process.env.CLICKHOUSE_DATABASE ?? "peercode",
  },

  // Coordination constants (TECH_SPEC §5, §8)
  lockTtlMs: num(process.env.LOCK_TTL_MS, 30 * MINUTE),
  heartbeatIntervalMs: num(process.env.HEARTBEAT_INTERVAL_MS, 5 * MINUTE),
  debateMaxRounds: num(process.env.DEBATE_MAX_ROUNDS, 5),
  debateTimeoutMs: num(process.env.DEBATE_TIMEOUT_MS, 10 * MINUTE),
  sweeperIntervalMs: num(process.env.SWEEPER_INTERVAL_MS, 30 * SECOND),
} as const;

export type Config = typeof config;
