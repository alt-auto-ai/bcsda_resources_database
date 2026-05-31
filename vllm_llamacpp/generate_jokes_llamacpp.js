#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return false;

  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) continue;

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }

  return true;
}

const envFilePath = path.resolve(process.cwd(), ".env.llamacpp");
const envLoaded = loadEnvFile(envFilePath);

const inputPath = process.argv[2] || "input.csv";
const resolvedPath = path.resolve(process.cwd(), inputPath);

const baseUrl = (process.env.LLAMACPP_BASE_URL || "http://localhost:8080").replace(/\/+$/, "");
const apiKey = process.env.LLAMACPP_API_KEY;
const model = process.env.LLAMACPP_MODEL;
const promptFilePath = path.resolve(process.cwd(), process.env.LLAMACPP_PROMPT_FILE || "prompt.llamacpp.yaml");
const systemPrompt = (
  process.env.LLAMACPP_SYSTEM_PROMPT ||
  "You are a helpful assistant. Follow the user prompt exactly and return plain text only."
).trim();
const outputColumnBase = (process.env.LLAMACPP_OUTPUT_COLUMN_BASE || "llamacpp_output").trim();
const rawMaxTokens = (process.env.LLAMACPP_MAX_TOKENS || "").trim();
const maxTokens = rawMaxTokens === "" ? null : Number.parseInt(rawMaxTokens, 10);
const timeoutMs = Number.parseInt(process.env.LLAMACPP_TIMEOUT_MS || "30000", 10);
const maxRetries = Number.parseInt(process.env.LLAMACPP_MAX_RETRIES || "2", 10);
const saveEvery = Number.parseInt(process.env.LLAMACPP_SAVE_EVERY || "25", 10);

if (!envLoaded) {
  console.error("Missing .env.llamacpp file. Copy .env.llamacpp.example to .env.llamacpp and set values.");
  process.exit(1);
}

if (!apiKey) {
  console.error("Missing LLAMACPP_API_KEY in .env.llamacpp or environment.");
  process.exit(1);
}

if (!model) {
  console.error("Missing LLAMACPP_MODEL in .env.llamacpp or environment.");
  process.exit(1);
}

if (!systemPrompt) {
  console.error("Missing LLAMACPP_SYSTEM_PROMPT in .env.llamacpp or environment.");
  process.exit(1);
}

if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  console.error("LLAMACPP_TIMEOUT_MS must be a positive integer.");
  process.exit(1);
}

if (!Number.isFinite(maxRetries) || maxRetries < 0) {
  console.error("LLAMACPP_MAX_RETRIES must be 0 or greater.");
  process.exit(1);
}

if (!Number.isFinite(saveEvery) || saveEvery < 1) {
  console.error("LLAMACPP_SAVE_EVERY must be a positive integer.");
  process.exit(1);
}

if (maxTokens !== null && (!Number.isFinite(maxTokens) || (maxTokens !== -1 && maxTokens < 1))) {
  console.error("LLAMACPP_MAX_TOKENS must be empty (unlimited), -1 (unlimited), or a positive integer.");
  process.exit(1);
}

function parsePromptYaml(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing prompt YAML file: ${filePath}`);
  }

  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/);
  const config = {};

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const keyMatch = raw.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!keyMatch) continue;

    const key = keyMatch[1];
    const rawValue = keyMatch[2] || "";

    if (rawValue === "|" || rawValue === ">") {
      const collected = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const next = lines[j];
        if (/^[ \t]+/.test(next)) {
          collected.push(next.replace(/^[ \t]{1,2}/, ""));
        } else if (next.trim() === "") {
          collected.push("");
        } else {
          break;
        }
      }
      config[key] = collected.join("\n").trim();
      i = j - 1;
      continue;
    }

    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    config[key] = value;
  }

  return config;
}

function makeUniqueColumnName(headers, base) {
  const normalized = (base || "joke_llamacpp").trim() || "joke_llamacpp";
  const existing = new Set(headers.map((h) => h.trim().toLowerCase()));
  if (!existing.has(normalized.toLowerCase())) return normalized;

  let suffix = 2;
  while (existing.has(`${normalized}_${suffix}`.toLowerCase())) {
    suffix++;
  }
  return `${normalized}_${suffix}`;
}

const promptConfig = parsePromptYaml(promptFilePath);
const userPromptTemplate = (promptConfig.prompt || "").trim();

if (!userPromptTemplate) {
  console.error(`Missing prompt in YAML: ${promptFilePath}`);
  process.exit(1);
}

if (!userPromptTemplate.includes("{{item}}")) {
  console.error(`YAML prompt must include {{item}} placeholder in: ${promptFilePath}`);
  process.exit(1);
}

function parseCSV(content) {
  const allRows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];

    if (char === '"') {
      if (inQuotes && content[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && content[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((cell) => cell.length > 0)) {
        allRows.push(row);
      }
      row = [];
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.length > 0)) {
      allRows.push(row);
    }
  }

  if (allRows.length === 0) return { headers: [], rows: [] };
  return { headers: allRows[0], rows: allRows.slice(1) };
}

function escapeCSVField(value) {
  const str = String(value ?? "");
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCSV(headers, rows) {
  const headerLine = headers.map(escapeCSVField).join(",");
  const rowLines = rows.map((row) => row.map(escapeCSVField).join(","));
  return [headerLine, ...rowLines].join("\n") + "\n";
}

function tryExtractText(content) {
  const trimmed = (content || "").trim();
  if (!trimmed) return "";

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed.joke === "string") {
      return parsed.joke.trim();
    }
    if (parsed && typeof parsed.output === "string") {
      return parsed.output.trim();
    }
  } catch (_) {
    // fall through
  }

  const match = trimmed.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (parsed && typeof parsed.joke === "string") {
        return parsed.joke.trim();
      }
      if (parsed && typeof parsed.output === "string") {
        return parsed.output.trim();
      }
    } catch (_) {
      // fall through
    }
  }

  return trimmed.replace(/^"|"$/g, "").trim();
}

function isLikelyValidOutput(text) {
  const value = (text || "").trim();
  if (!value) return false;

  if (value.includes("<|")) return false;
  if (!/[a-zA-Z]/.test(value)) return false;

  return true;
}

function extractAssistantFromVerbose(data) {
  const verbose = data?.__verbose?.content;
  if (!verbose || typeof verbose !== "string") return "";

  const marker = "<|start|>assistant<|channel|>final<|message|>";
  const idx = verbose.lastIndexOf(marker);
  if (idx === -1) return "";

  const tail = verbose.slice(idx + marker.length);
  const endTagIndex = tail.indexOf("<|end|>");
  if (endTagIndex !== -1) {
    return tail.slice(0, endTagIndex).trim();
  }
  return tail.trim();
}

function extractResponseText(data) {
  const direct = data?.choices?.[0]?.message?.content;
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }

  const fromVerbose = extractAssistantFromVerbose(data);
  if (fromVerbose) return fromVerbose;

  return "";
}

function normalizeOutput(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function logInfo(message) {
  console.log(`[${nowIso()}] INFO  ${message}`);
}

function logWarn(message) {
  console.warn(`[${nowIso()}] WARN  ${message}`);
}

function logError(message) {
  console.error(`[${nowIso()}] ERROR ${message}`);
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function shorten(text, max = 80) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 3)}...`;
}

async function generateOutput(item, context) {
  const userPrompt = userPromptTemplate.replaceAll("{{item}}", item);

  const payload = {
    model,
    temperature: 0.7,
    messages: [
      {
        role: "system",
        content: systemPrompt
      },
      {
        role: "user",
        content: userPrompt
      }
    ]
  };

  if (maxTokens !== null) {
    payload.max_tokens = maxTokens;
  }

  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const attemptNo = attempt + 1;
    const attemptStartedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    logInfo(
      `[${context}] API request attempt ${attemptNo}/${maxRetries + 1} (prompt chars=${userPrompt.length})`
    );

    try {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!response.ok) {
        const body = await response.text();
        const isRetryable = response.status >= 500;
        const error = new Error(`API error ${response.status}: ${body}`);
        const elapsed = formatDuration(Date.now() - attemptStartedAt);
        if (isRetryable && attempt < maxRetries) {
          logWarn(`[${context}] attempt ${attemptNo} failed in ${elapsed}; retrying. ${error.message}`);
          lastError = error;
          continue;
        }
        logError(`[${context}] attempt ${attemptNo} failed in ${elapsed}; no more retries. ${error.message}`);
        throw error;
      }

      const data = await response.json();
      const content = extractResponseText(data);
      const output = normalizeOutput(tryExtractText(content));
      if (!isLikelyValidOutput(output)) {
        const finishReason = data?.choices?.[0]?.finish_reason;
        if (finishReason === "length") {
          const error = new Error(
            "Model output was truncated (finish_reason=length). Increase LLAMACPP_MAX_TOKENS or shorten the YAML prompt."
          );
          if (attempt < maxRetries) {
            logWarn(
              `[${context}] attempt ${attemptNo} returned truncated output; retrying with same payload.`
            );
            lastError = error;
            continue;
          }
          throw error;
        }
        const error = new Error(`Invalid or truncated model output: ${String(content || "").slice(0, 120)}`);
        if (attempt < maxRetries) {
          logWarn(`[${context}] attempt ${attemptNo} returned invalid output; retrying.`);
          lastError = error;
          continue;
        }
        throw error;
      }
      const elapsed = formatDuration(Date.now() - attemptStartedAt);
      logInfo(`[${context}] attempt ${attemptNo} succeeded in ${elapsed} (response chars=${output.length})`);
      return output;
    } catch (err) {
      const isAbort = err && err.name === "AbortError";
      const message = isAbort ? `Request timeout after ${timeoutMs} ms` : (err?.message || String(err));
      lastError = new Error(message);
      if (attempt >= maxRetries) {
        logError(`[${context}] final attempt failed. ${message}`);
        throw lastError;
      }
      logWarn(`[${context}] attempt ${attemptNo} failed. Retrying. ${message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error("Unknown request error");
}

async function main() {
  const runStartedAt = Date.now();

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`CSV file not found: ${resolvedPath}`);
  }

  logInfo("Run started");
  logInfo(`Env file: ${envFilePath}`);
  logInfo(`CSV input: ${resolvedPath}`);
  logInfo(`Prompt YAML: ${promptFilePath}`);
  logInfo(`API base URL: ${baseUrl}`);
  logInfo(`Model: ${model}`);
  logInfo(`Timeout per request: ${timeoutMs} ms`);
  logInfo(`Max retries: ${maxRetries}`);
  logInfo(`Checkpoint frequency: every ${saveEvery} rows`);
  logInfo(`Output column base: ${outputColumnBase}`);

  const csvText = fs.readFileSync(resolvedPath, "utf8");
  const { headers, rows } = parseCSV(csvText);

  if (headers.length === 0) {
    throw new Error("CSV is empty.");
  }

  logInfo(`CSV parsed: header columns=${headers.length}, data rows=${rows.length}`);

  const itemIndex = headers.findIndex((h) => {
    const key = h.trim().toLowerCase();
    return key === "item" || key === "items";
  });

  if (itemIndex === -1) {
    throw new Error('Missing required column: "item" or "items"');
  }

  logInfo(`Item column index resolved: ${itemIndex} (${headers[itemIndex]})`);

  const outputColumn = makeUniqueColumnName(headers, outputColumnBase);
  headers.push(outputColumn);
  const outputIndex = headers.length - 1;
  logInfo(`Output column selected: ${outputColumn}`);

  function flushProgress() {
    const output = toCSV(headers, rows);
    fs.writeFileSync(resolvedPath, output, "utf8");
  }

  process.on("SIGINT", () => {
    logWarn("SIGINT received. Saving current progress before exit.");
    try {
      flushProgress();
      logInfo(`Progress written to: ${resolvedPath}`);
    } catch (err) {
      logError(`Failed to save progress: ${err?.message || String(err)}`);
    }
    process.exit(130);
  });

  let successCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let processedWithItem = 0;

  for (let i = 0; i < rows.length; i++) {
    const rowStartedAt = Date.now();
    const row = rows[i];
    while (row.length < headers.length) row.push("");

    const item = (row[itemIndex] || "").trim();
    const context = `Row ${i + 1}/${rows.length}`;

    logInfo(`${context} start`);
    if (!item) {
      row[outputIndex] = "";
      skippedCount++;
      logWarn(`${context} skipped: empty item value`);
      const completed = i + 1;
      const elapsedMs = Date.now() - runStartedAt;
      const avgMs = completed > 0 ? elapsedMs / completed : 0;
      const remainingMs = avgMs * (rows.length - completed);
      logInfo(
        `Progress ${completed}/${rows.length} (${((completed / rows.length) * 100).toFixed(2)}%) | success=${successCount} failed=${failedCount} skipped=${skippedCount} | elapsed=${formatDuration(
          elapsedMs
        )} eta=${formatDuration(remainingMs)}`
      );
      continue;
    }

    processedWithItem++;
    logInfo(`${context} item preview: "${shorten(item, 120)}"`);
    try {
      const output = await generateOutput(item, context);
      row[outputIndex] = output;
      successCount++;
      logInfo(`${context} completed successfully in ${formatDuration(Date.now() - rowStartedAt)}`);
    } catch (err) {
      row[outputIndex] = `ERROR: ${err.message}`;
      failedCount++;
      logError(`${context} failed in ${formatDuration(Date.now() - rowStartedAt)}. ${err.message}`);
    }

    if ((i + 1) % saveEvery === 0) {
      flushProgress();
      logInfo(`${context} checkpoint saved`);
    }

    const completed = i + 1;
    const elapsedMs = Date.now() - runStartedAt;
    const avgMs = completed > 0 ? elapsedMs / completed : 0;
    const remainingMs = avgMs * (rows.length - completed);
    logInfo(
      `Progress ${completed}/${rows.length} (${((completed / rows.length) * 100).toFixed(2)}%) | success=${successCount} failed=${failedCount} skipped=${skippedCount} | elapsed=${formatDuration(
        elapsedMs
      )} eta=${formatDuration(remainingMs)}`
    );
  }

  flushProgress();
  logInfo(`Updated file: ${resolvedPath}`);
  logInfo(
    `Run complete. processed_with_item=${processedWithItem}, success=${successCount}, failed=${failedCount}, skipped=${skippedCount}, duration=${formatDuration(
      Date.now() - runStartedAt
    )}`
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
