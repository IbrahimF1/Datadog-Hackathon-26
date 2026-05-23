import tracer from "dd-trace";
import { config } from "../config.js";

// Datadog LLM Observability ("LapDog"). Manual spans only — we instrument
// planning, debates, Nimble retrieval, and every MCP tool call by hand.

export type SpanKind =
  | "workflow"
  | "llm"
  | "tool"
  | "agent"
  | "task"
  | "retrieval";

interface SpanOptions {
  kind: SpanKind;
  name: string;
  modelName?: string;
  modelProvider?: string;
}

interface AnnotateData {
  inputData?: unknown;
  outputData?: unknown;
  metadata?: Record<string, unknown>;
  metrics?: Record<string, number>;
  tags?: Record<string, unknown>;
}

// dd-trace's llmobs surface is loosely typed across versions; treat as any.
let llmobs: any = null;

export function initObservability(): void {
  if (!config.datadog.enabled) {
    console.log("[datadog] LLM Observability disabled (DD_LLMOBS_ENABLED=0)");
    return;
  }
  try {
    tracer.init({
      llmobs: {
        mlApp: config.datadog.mlApp,
        agentlessEnabled: config.datadog.agentless,
      },
    } as any);
    llmobs = (tracer as any).llmobs ?? null;
    if (!llmobs) {
      console.warn("[datadog] tracer initialised but llmobs unavailable");
      return;
    }
    console.log(
      `[datadog] LLM Observability enabled (mlApp=${config.datadog.mlApp}, agentless=${config.datadog.agentless})`,
    );
  } catch (err) {
    llmobs = null;
    console.warn(`[datadog] init failed: ${(err as Error).message}`);
  }
}

// Run `fn` inside an LLM Observability span. No-op wrapper when disabled.
export async function traceSpan<T>(
  opts: SpanOptions,
  fn: () => Promise<T>,
): Promise<T> {
  if (!llmobs) return fn();
  return llmobs.trace(opts, async () => fn());
}

export function annotate(data: AnnotateData): void {
  if (!llmobs) return;
  try {
    llmobs.annotate(data);
  } catch {
    // annotation must never break the traced operation
  }
}

export async function flushObservability(): Promise<void> {
  if (llmobs?.flush) {
    try {
      await llmobs.flush();
    } catch {
      /* ignore */
    }
  }
}

export function observabilityEnabled(): boolean {
  return !!llmobs;
}
