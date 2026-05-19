import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { complete, getModel } from "@earendil-works/pi-ai";

const MODEL_CANDIDATES = [
  ["anthropic", "claude-haiku-4-5"],
  ["openai", "gpt-5-mini"],
  ["google", "gemini-2.5-flash"],
];
const WARN_THRESHOLD = 0.7;
const LOG_DIR = path.join(".agent-work", "pm", "session-logs");
const TODO_DIR = path.join(".agent-work", "pm", "session-todos");
const PROMPT_DIR = path.join(".pi", "skills", "atlassian-session-log", "references");

let warnedForHighContext = false;

function findRepoRoot(startCwd) {
  let current = path.resolve(startCwd);
  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startCwd);
    current = parent;
  }
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function timestampStamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
}

function extractTextParts(content) {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  const parts = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "text" && typeof item.text === "string") parts.push(item.text);
  }
  return parts;
}

function extractToolCallLines(content) {
  if (!Array.isArray(content)) return [];
  const lines = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "toolCall" && typeof item.name === "string") {
      lines.push(`Tool ${item.name} called with args ${JSON.stringify(item.arguments || {})}`);
    }
  }
  return lines;
}

function buildConversationText(entries) {
  const sections = [];
  for (const entry of entries || []) {
    if (entry.type !== "message" || !entry.message || !entry.message.role) continue;
    const role = entry.message.role;
    if (!["user", "assistant", "tool"].includes(role)) continue;
    const lines = [];
    const textParts = extractTextParts(entry.message.content);
    if (textParts.length) {
      const label = role[0].toUpperCase() + role.slice(1);
      lines.push(`${label}: ${textParts.join("\n").trim()}`);
    }
    if (role === "assistant") lines.push(...extractToolCallLines(entry.message.content));
    if (lines.length) sections.push(lines.join("\n"));
  }
  return sections.join("\n\n");
}

function parseFlags(rawArgs, defaultCompact) {
  const tokens = rawArgs.trim().split(/\s+/).filter(Boolean);
  const flags = new Set(tokens.filter((token) => token.startsWith("--")));
  const focus = tokens.filter((token) => !token.startsWith("--")).join(" ");
  return {
    focus,
    draft: flags.has("--draft") || flags.has("--no-publish"),
    compact: flags.has("--no-compact") ? false : defaultCompact,
    todo: flags.has("--todo"),
  };
}

async function readText(filePath) {
  return fsp.readFile(filePath, "utf8");
}

function runCommand(command, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => resolve({ ok: false, code: -1, stdout, stderr: `${stderr}${error.message}` }));
    child.on("close", (code) => resolve({ ok: code === 0, code, stdout, stderr }));
  });
}

async function buildPmSnapshot(repoRoot, branch) {
  const pidFile = path.join(repoRoot, ".agent-work", "pm", "pm-daemon.pid");
  const logFile = path.join(repoRoot, ".agent-work", "pm", "pm-daemon.log");
  const briefingFile = path.join(repoRoot, ".agent-work", "pm", "PROJECT_PM_BRIEFING.md");
  let daemon = { running: false, pid: null, logFile };

  if (fs.existsSync(pidFile)) {
    try {
      const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
      if (pid && Number.isFinite(pid)) {
        try {
          process.kill(pid, 0);
          daemon = { running: true, pid, logFile };
        } catch (_error) {
          // no-op
        }
      }
    } catch (_error) {
      // no-op
    }
  }

  const briefing = fs.existsSync(briefingFile)
    ? {
        exists: true,
        path: briefingFile,
        updatedAt: new Date(fs.statSync(briefingFile).mtimeMs).toISOString(),
      }
    : { exists: false, path: briefingFile };

  const pmCheck = await runCommand("python3", ["scripts/pm/atlassian_pm_link.py", "check"], repoRoot);
  const rootPr = await runCommand(
    "gh",
    ["pr", "list", "--head", branch, "--state", "open", "--json", "number,title,url"],
    repoRoot,
  );
  const backendPr = await runCommand(
    "gh",
    [
      "pr",
      "list",
      "-R",
      "adamtasteslikegood/tasteslikegood.com",
      "--head",
      branch,
      "--state",
      "open",
      "--json",
      "number,title,url",
    ],
    repoRoot,
  );

  return {
    daemon,
    briefing,
    pmCheck: {
      ok: pmCheck.ok,
      output: (pmCheck.stdout || pmCheck.stderr).trim().slice(0, 4000),
    },
    prs: {
      root: rootPr.ok ? JSON.parse(rootPr.stdout || "[]") : [],
      backend: backendPr.ok ? JSON.parse(backendPr.stdout || "[]") : [],
    },
  };
}

async function resolveSummarizer(ctx) {
  for (const [provider, id] of MODEL_CANDIDATES) {
    const model = getModel(provider, id);
    if (!model) continue;
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (auth && auth.ok && auth.apiKey) return { model, auth, label: `${provider}/${id}` };
  }

  if (ctx.model) {
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
    if (auth && auth.ok && auth.apiKey) {
      return {
        model: ctx.model,
        auth,
        label: `${ctx.model.provider}/${ctx.model.id}`,
      };
    }
  }

  return null;
}

async function callCheapModel(ctx, promptText) {
  const resolved = await resolveSummarizer(ctx);
  if (!resolved) throw new Error("No low-cost summarizer model with auth was available.");

  const response = await complete(
    resolved.model,
    {
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: promptText }],
          timestamp: Date.now(),
        },
      ],
    },
    {
      apiKey: resolved.auth.apiKey,
      headers: resolved.auth.headers,
      reasoningEffort: "minimal",
    },
  );

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  return { text, modelLabel: resolved.label };
}

async function writeArtifact(repoRoot, relativeDir, prefix, branch, content) {
  const stamp = timestampStamp();
  const dir = path.join(repoRoot, relativeDir);
  await fsp.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${stamp}-${slugify(branch)}-${prefix}.md`);
  await fsp.writeFile(filePath, content, "utf8");
  return filePath;
}

async function publishSessionLog(repoRoot, filePath) {
  return runCommand(
    "bash",
    ["scripts/pm/run_pm_script.sh", "publish_session_log.py", "--file", filePath],
    repoRoot,
  );
}

function buildLogPrompt({ focus, conversationText, pmSnapshot, schema, aotaModel, branch, sessionFile, trigger }) {
  return [
    "Generate a Confluence-ready session log for this repository.",
    "Write in concise operational markdown.",
    "Use the schema and operating model exactly.",
    "State whether Atlassian is Aligned, Partially aligned, or Drifting.",
    "If Atlassian state is stale, say so plainly and recommend KAN, RCP, and Confluence updates.",
    "Keep the log non-destructive and handoff-friendly.",
    "",
    `Trigger: ${trigger}`,
    `Branch: ${branch}`,
    `Session file: ${sessionFile || "ephemeral"}`,
    `Focus override: ${focus || "(none)"}`,
    "",
    "## Operating model",
    aotaModel,
    "",
    "## Schema",
    schema,
    "",
    "## PM snapshot",
    JSON.stringify(pmSnapshot, null, 2),
    "",
    "## Conversation transcript",
    conversationText,
  ].join("\n");
}

function buildTodoPrompt({ focus, sessionLogText, todoSchema, aotaModel }) {
  return [
    "Convert the following session log into actionable follow-up TODOs.",
    "Separate KAN execution TODOs, RCP delivery TODOs, and Confluence TODOs.",
    "Keep each item handoff-ready.",
    "",
    `Focus override: ${focus || "(none)"}`,
    "",
    "## Operating model",
    aotaModel,
    "",
    "## TODO schema",
    todoSchema,
    "",
    "## Session log",
    sessionLogText,
  ].join("\n");
}

async function handleSessionLog(rawArgs, ctx, commandName, defaultCompact) {
  const repoRoot = findRepoRoot(ctx.cwd);
  const branchResult = await runCommand("git", ["branch", "--show-current"], repoRoot);
  const branch = branchResult.stdout.trim() || "unknown-branch";
  const sessionFile = ctx.sessionManager.getSessionFile ? ctx.sessionManager.getSessionFile() : undefined;
  const options = parseFlags(rawArgs, defaultCompact);
  const conversationText = buildConversationText(ctx.sessionManager.getBranch());

  if (!conversationText.trim()) {
    if (ctx.hasUI) ctx.ui.notify("No conversation text found to summarize.", "warning");
    return;
  }

  if (ctx.waitForIdle) await ctx.waitForIdle();
  if (ctx.hasUI) ctx.ui.notify(`${commandName}: building PM snapshot...`, "info");

  const aotaModel = await readText(path.join(repoRoot, PROMPT_DIR, "AOTA_MODEL.md"));
  const logSchema = await readText(path.join(repoRoot, PROMPT_DIR, "SESSION_LOG_SCHEMA.md"));
  const todoSchema = await readText(path.join(repoRoot, PROMPT_DIR, "TODO_SCHEMA.md"));
  const pmSnapshot = await buildPmSnapshot(repoRoot, branch);

  if (ctx.hasUI) ctx.ui.notify(`${commandName}: generating session log...`, "info");
  const logResult = await callCheapModel(
    ctx,
    buildLogPrompt({
      focus: options.focus,
      conversationText,
      pmSnapshot,
      schema: logSchema,
      aotaModel,
      branch,
      sessionFile,
      trigger: commandName,
    }),
  );

  const frontMatter = [
    `<!-- trigger: ${commandName} -->`,
    `<!-- branch: ${branch} -->`,
    `<!-- model: ${logResult.modelLabel} -->`,
    `<!-- created_at: ${new Date().toISOString()} -->`,
    "",
  ].join("\n");
  const finalLog = `${frontMatter}${logResult.text}\n`;
  const logPath = await writeArtifact(repoRoot, LOG_DIR, "session-log", branch, finalLog);

  let todoPath = null;
  if (options.todo) {
    if (ctx.hasUI) ctx.ui.notify(`${commandName}: generating TODO draft...`, "info");
    const todoResult = await callCheapModel(
      ctx,
      buildTodoPrompt({ focus: options.focus, sessionLogText: finalLog, todoSchema, aotaModel }),
    );
    todoPath = await writeArtifact(repoRoot, TODO_DIR, "session-todo", branch, `${todoResult.text}\n`);
  }

  let publishOutput = null;
  if (!options.draft) {
    if (ctx.hasUI) ctx.ui.notify(`${commandName}: publishing session log to Confluence...`, "info");
    publishOutput = await publishSessionLog(repoRoot, logPath);
  }

  if (ctx.hasUI) {
    ctx.ui.notify(`Session log saved: ${path.relative(repoRoot, logPath)}`, "info");
    if (todoPath) ctx.ui.notify(`TODO draft saved: ${path.relative(repoRoot, todoPath)}`, "info");
    if (publishOutput && publishOutput.ok) ctx.ui.notify("Confluence session log published.", "info");
    if (publishOutput && !publishOutput.ok) {
      ctx.ui.notify(`Confluence publish failed: ${(publishOutput.stderr || publishOutput.stdout).trim()}`, "error");
    }
  }

  if (options.compact) {
    ctx.compact({
      customInstructions: `A session log was created at ${path.relative(repoRoot, logPath)}. Preserve the latest status, alignment verdict, and next actions.`,
      onComplete: () => {
        if (ctx.hasUI) ctx.ui.notify("Compaction completed after session sync.", "info");
      },
      onError: (error) => {
        if (ctx.hasUI) ctx.ui.notify(`Compaction failed: ${error.message}`, "error");
      },
    });
  }
}

export default function atlassianAotaExtension(pi) {
  const completions = [
    { value: "--draft", label: "--draft" },
    { value: "--no-compact", label: "--no-compact" },
    { value: "--todo", label: "--todo" },
  ];

  const registerLogCommand = (name, compactByDefault) => {
    pi.registerCommand(name, {
      description: compactByDefault
        ? "Generate a Confluence session log, optionally publish it, then compact"
        : "Generate a Confluence-ready session log and optional TODO draft",
      getArgumentCompletions: (prefix) => completions.filter((item) => item.value.startsWith(prefix)),
      handler: async (args, ctx) => {
        await handleSessionLog(args, ctx, name, compactByDefault);
      },
    });
  };

  registerLogCommand("session-log", false);
  registerLogCommand("sync-clear", true);
  registerLogCommand("smart-clear", true);

  pi.on("session_start", async () => {
    warnedForHighContext = false;
  });

  pi.on("turn_end", async (_event, ctx) => {
    if (!ctx.hasUI || warnedForHighContext) return;
    const usage = ctx.getContextUsage ? ctx.getContextUsage() : null;
    const contextWindow = ctx.model && ctx.model.contextWindow;
    if (!usage || !usage.tokens || !contextWindow) return;
    const ratio = usage.tokens / contextWindow;
    if (ratio < WARN_THRESHOLD) return;
    warnedForHighContext = true;
    ctx.ui.notify(
      `Context is at ${(ratio * 100).toFixed(1)}%. Run /sync-clear to publish a session log and compact safely.`,
      "warning",
    );
  });
}
