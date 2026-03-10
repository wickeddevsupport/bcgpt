import {
  callWorkspaceModelAgentLoop,
  type ChatToolDefinition,
} from "./workflow-ai.js";

type Message = { role: "user" | "assistant"; content: string };

export type PmosParallelSubtask = {
  label?: string;
  task: string;
};

export type PmosParallelSubtaskResult = {
  label?: string;
  task: string;
  ok: boolean;
  text?: string;
  error?: string;
  providerUsed?: string;
};

export async function runPmosParallelSubtasks(params: {
  workspaceId: string;
  baseSystemPrompt: string;
  userMessages: Message[];
  tasks: PmosParallelSubtask[];
  tools: ChatToolDefinition[];
  executeTool: (name: string, args: Record<string, unknown>) => Promise<string>;
  maxIterations?: number;
}): Promise<{
  summary: string;
  results: PmosParallelSubtaskResult[];
}> {
  const tasks = params.tasks
    .map((task) => ({
      label: typeof task.label === "string" && task.label.trim() ? task.label.trim() : undefined,
      task: String(task.task ?? "").trim(),
    }))
    .filter((task) => task.task);

  if (tasks.length === 0) {
    return {
      summary: "No valid subtask prompts were provided.",
      results: [],
    };
  }

  const childTools = params.tools.filter(
    (tool) => tool.function.name !== "pmos_parallel_subtasks",
  );

  const results = await Promise.all(
    tasks.map(async (task): Promise<PmosParallelSubtaskResult> => {
      const childSystemPrompt = [
        params.baseSystemPrompt,
        "",
        "## Subagent Mode",
        "- You are a temporary parallel subagent spawned by the parent PMOS workspace operator.",
        "- Focus only on the assigned subtask.",
        "- Use workspace tools when they help this subtask, but do not try to solve the entire user request.",
        "- Return a concise findings memo for the parent agent: key facts, evidence, useful recommendations, and unresolved gaps.",
        "- Do not refer to yourself as the main agent.",
      ].join("\n");

      const childMessages: Message[] = [
        ...params.userMessages,
        {
          role: "user",
          content: [
            "Parallel subtask assignment for the parent agent.",
            task.label ? `Label: ${task.label}` : null,
            `Assigned subtask: ${task.task}`,
            "Return only the findings for this subtask so the parent agent can aggregate them.",
          ]
            .filter((line): line is string => Boolean(line))
            .join("\n"),
        },
      ];

      const result = await callWorkspaceModelAgentLoop(
        params.workspaceId,
        childSystemPrompt,
        childMessages,
        childTools,
        params.executeTool,
        {
          maxIterations: params.maxIterations ?? 4,
          allowToolResultEarlyExit: false,
        },
      );

      return {
        label: task.label,
        task: task.task,
        ok: result.ok && typeof result.text === "string" && result.text.trim().length > 0,
        text: typeof result.text === "string" ? result.text.trim() : undefined,
        error: result.ok ? undefined : result.error,
        providerUsed: result.providerUsed,
      };
    }),
  );

  return {
    summary: summarizePmosParallelSubtasks(results),
    results,
  };
}

export function summarizePmosParallelSubtasks(
  results: PmosParallelSubtaskResult[],
): string {
  if (results.length === 0) {
    return "No subagent results were produced.";
  }
  const okCount = results.filter((result) => result.ok).length;
  const failedCount = results.length - okCount;
  const labels = results
    .map((result, index) => result.label?.trim() || `task ${index + 1}`)
    .slice(0, 4);
  const parts = [`Parallel subagents completed ${okCount}/${results.length} assigned tasks.`];
  if (failedCount > 0) {
    parts.push(`${failedCount} task(s) failed or returned no usable memo.`);
  }
  if (labels.length > 0) {
    parts.push(`Covered: ${labels.join(", ")}.`);
  }
  return parts.join(" ");
}
