import { config } from "../config.js";
import { ExternalServiceError } from "../services/errors.js";
import { annotate, traceSpan } from "../observability/datadog.js";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

// Nimble agent web search. Used ONLY by planning and debates (see skill docs).
// Endpoint + auth are configurable because Nimble spans two product
// generations; defaults target the SERP real-time search endpoint.
export class NimbleClient {
  available(): boolean {
    const n = config.nimble;
    return !!(n.authHeader || n.apiKey || (n.username && n.password));
  }

  private authValue(): string {
    const n = config.nimble;
    if (n.authHeader) return n.authHeader;
    if (n.apiKey) return `Bearer ${n.apiKey}`;
    if (n.username && n.password) {
      const b64 = Buffer.from(`${n.username}:${n.password}`).toString("base64");
      return `Basic ${b64}`;
    }
    throw new ExternalServiceError("nimble", "no credentials configured");
  }

  async search(query: string, limit = 5): Promise<SearchResult[]> {
    return traceSpan(
      { kind: "retrieval", name: "nimble.web_search" },
      async () => {
        annotate({ inputData: { query, limit }, tags: { provider: "nimble" } });
        if (!this.available()) {
          throw new ExternalServiceError("nimble", "not configured");
        }

        let res: Response;
        try {
          res = await fetch(config.nimble.baseUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: this.authValue(),
            },
            body: JSON.stringify({
              query,
              search_engine: config.nimble.searchEngine,
              parse: true,
            }),
          });
        } catch (err) {
          throw new ExternalServiceError("nimble", (err as Error).message);
        }

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new ExternalServiceError(
            "nimble",
            `HTTP ${res.status} ${text.slice(0, 200)}`,
          );
        }

        const body = (await res.json().catch(() => ({}))) as unknown;
        const results = extractResults(body).slice(0, limit);
        annotate({ outputData: { count: results.length, results } });
        return results;
      },
    );
  }
}

// Tolerant extraction across Nimble response shapes (parsed SERP, organic
// results, generic results arrays).
function extractResults(body: unknown): SearchResult[] {
  const out: SearchResult[] = [];
  const seen = new Set<string>();

  const visit = (node: unknown): void => {
    if (out.length >= 50 || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const obj = node as Record<string, unknown>;
    const url = pickString(obj, ["url", "link", "href"]);
    const title = pickString(obj, ["title", "name", "heading"]);
    if (url && title && !seen.has(url)) {
      seen.add(url);
      out.push({
        title,
        url,
        snippet: pickString(obj, ["snippet", "description", "text", "content"]) ?? "",
      });
    }
    for (const v of Object.values(obj)) visit(v);
  };

  visit(body);
  return out;
}

function pickString(
  obj: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return undefined;
}
