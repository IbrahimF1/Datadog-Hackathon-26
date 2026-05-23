import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import type { ContractType } from "../domain/types.js";
import { ExternalServiceError } from "../services/errors.js";
import { annotate, traceSpan } from "../observability/datadog.js";
import type { NimbleClient } from "./nimbleClient.js";

export interface PlanContract {
  type: ContractType;
  name: string;
  definition: string;
}
export interface PlanTask {
  title: string;
  description: string;
  dependencies: string[]; // references other task titles in the plan
  requiredSkills: string[];
  interfaceContracts: PlanContract[];
  mergePoint: boolean;
  suggestedAssignee?: string; // team member name for initial assignment
}
export interface PlanPhase {
  name: string;
  tasks: PlanTask[];
}
export interface DecompositionResult {
  phases: PlanPhase[];
  questions: { memberName: string; question: string }[];
}

export interface DecomposeInput {
  description: string;
  team: { name: string; role: string; skills: string[] }[];
  answers?: { memberName: string; question: string; answer: string }[];
}

const MAX_TURNS = 8;

const SYSTEM_PROMPT = `You are PeerCode Architect, an expert at breaking projects into parallelizable workstreams for a team whose members each run a Claude Code session.

Your job: decompose the project into PHASES (in execution order), each containing TASKS. For each task provide title, description, dependencies (titles of other tasks), required skills, interface contracts, and the SUGGESTED ASSIGNEE (name of the team member whose skills best match the required skills). Mark mergePoint=true for tasks whose contracts must lock at a phase boundary.

Constraints: minimize blocking dependencies, maximize parallel work within a phase, lock interfaces at phase boundaries, and assign each task to the team member whose skills best fit (spread work evenly across the team). Also produce a short list of clarifying QUESTIONS addressed to specific team members to refine assignments.

You may call web_search to ground decisions in current facts about frameworks, libraries, or APIs. When ready, you MUST call submit_plan exactly once with the full structured plan.`;

const CONTRACT_TYPES: ContractType[] = [
  "api_endpoint",
  "type_definition",
  "database_schema",
  "function_signature",
];

const submitPlanTool = {
  name: "submit_plan",
  description: "Submit the final structured decomposition plan.",
  input_schema: {
    type: "object",
    properties: {
      phases: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            tasks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  description: { type: "string" },
                  dependencies: { type: "array", items: { type: "string" } },
                  requiredSkills: { type: "array", items: { type: "string" } },
                  interfaceContracts: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        type: { type: "string", enum: CONTRACT_TYPES },
                        name: { type: "string" },
                        definition: { type: "string" },
                      },
                      required: ["type", "name", "definition"],
                    },
                  },
                  mergePoint: { type: "boolean" },
                  suggestedAssignee: { type: "string", description: "Name of the team member whose skills best match this task's required skills" },
                },
                required: [
                  "title",
                  "description",
                  "dependencies",
                  "requiredSkills",
                  "interfaceContracts",
                  "mergePoint",
                ],
              },
            },
          },
          required: ["name", "tasks"],
        },
      },
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            memberName: { type: "string" },
            question: { type: "string" },
          },
          required: ["memberName", "question"],
        },
      },
    },
    required: ["phases", "questions"],
  },
} as const;

const webSearchTool = {
  name: "web_search",
  description:
    "Search the web (via Nimble) for current information about frameworks, libraries, or APIs to ground the plan.",
  input_schema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
} as const;

export class AnthropicClient {
  private client: Anthropic;

  constructor(private readonly nimble: NimbleClient) {
    this.client = new Anthropic({ apiKey: config.anthropic.apiKey });
  }

  available(): boolean {
    return !!config.anthropic.apiKey;
  }

  async decompose(input: DecomposeInput): Promise<DecompositionResult> {
    if (!this.available()) {
      throw new ExternalServiceError("anthropic", "ANTHROPIC_API_KEY not set");
    }

    return traceSpan(
      { kind: "workflow", name: "planning.decompose" },
      async () => {
        annotate({ inputData: input, tags: { ml_app: config.datadog.mlApp } });

        const tools: any[] = [submitPlanTool];
        if (this.nimble.available()) tools.push(webSearchTool);

        const messages: any[] = [
          { role: "user", content: buildUserPrompt(input) },
        ];

        let plan: DecompositionResult | null = null;

        for (let turn = 0; turn < MAX_TURNS && !plan; turn++) {
          const resp = await traceSpan(
            {
              kind: "llm",
              name: "planning.llm",
              modelName: config.anthropic.model,
              modelProvider: "anthropic",
            },
            async () => {
              let r;
              try {
                r = await this.client.messages.create({
                  model: config.anthropic.model,
                  max_tokens: 8000,
                  system: SYSTEM_PROMPT,
                  tools,
                  messages,
                });
              } catch (err) {
                throw new ExternalServiceError(
                  "anthropic",
                  (err as Error).message,
                );
              }
              annotate({
                inputData: messages,
                outputData: r.content,
                metrics: {
                  inputTokens: r.usage.input_tokens,
                  outputTokens: r.usage.output_tokens,
                  totalTokens: r.usage.input_tokens + r.usage.output_tokens,
                },
              });
              return r;
            },
          );

          messages.push({ role: "assistant", content: resp.content });

          if (resp.stop_reason !== "tool_use") {
            messages.push({
              role: "user",
              content: "Please call submit_plan with the structured plan now.",
            });
            continue;
          }

          const toolResults: any[] = [];
          for (const block of resp.content) {
            if (block.type !== "tool_use") continue;
            if (block.name === "submit_plan") {
              plan = block.input as DecompositionResult;
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: "Plan received.",
              });
            } else if (block.name === "web_search") {
              const query = (block.input as { query: string }).query;
              let content: string;
              try {
                const results = await this.nimble.search(query);
                content = JSON.stringify(results);
              } catch (err) {
                content = `web_search failed: ${(err as Error).message}`;
              }
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content,
              });
            }
          }
          messages.push({ role: "user", content: toolResults });
        }

        if (!plan) {
          throw new ExternalServiceError(
            "anthropic",
            "model did not submit a plan within turn limit",
          );
        }
        annotate({ outputData: plan });
        return plan;
      },
    );
  }
}

function buildUserPrompt(input: DecomposeInput): string {
  const team = input.team
    .map((m) => `- ${m.name}: ${m.role}, skills: ${m.skills.join(", ") || "n/a"}`)
    .join("\n");
  const answers = input.answers?.length
    ? "\n\nTEAM ANSWERS TO PRIOR QUESTIONS:\n" +
      input.answers
        .map((a) => `- ${a.memberName} — ${a.question}\n  → ${a.answer}`)
        .join("\n")
    : "";
  return `PROJECT:\n${input.description}\n\nTEAM:\n${team}${answers}`;
}
