#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

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

function parseSimpleYaml(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Prompt YAML not found: ${filePath}`);
  }

  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/);
  const result = {};

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = raw.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) continue;

    const key = match[1];
    const rawValue = match[2] || "";

    if (rawValue === "|" || rawValue === ">") {
      const collected = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const next = lines[j];
        if (/^[ \t]+/.test(next)) {
          collected.push(next.replace(/^[ \t]{1,2}/, ""));
          continue;
        }
        if (next.trim() === "") {
          collected.push("");
          continue;
        }
        break;
      }
      result[key] = collected.join("\n").trim();
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
    result[key] = value;
  }

  if (!result.prompt) {
    const fallbackPrompt = text.trim();
    if (fallbackPrompt) {
      result.prompt = fallbackPrompt;
    }
  }

  return result;
}

function normalizeCell(value) {
  return String(value ?? "").replace(/\r?\n/g, " ").trim();
}

function normalizeModelAnswer(value) {
  return normalizeCell(value).replace(/\s*,+\s*$/g, "").trim();
}

function isBlankResponse(value) {
  const normalized = normalizeModelAnswer(value);
  return normalized === "" || normalized === "\"\"" || /^,+$/.test(normalizeCell(value));
}

function parseCSV(content) {
  const rows = [];
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
        rows.push(row);
      }
      row = [];
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.length > 0)) {
      rows.push(row);
    }
  }

  if (rows.length === 0) {
    return { headers: [], rows: [] };
  }

  return { headers: rows[0], rows: rows.slice(1) };
}

function escapeCsvCell(value) {
  const str = String(value ?? "");
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCSV(headers, rows) {
  const headerLine = headers.map(escapeCsvCell).join(",");
  const rowLines = rows.map((row) => row.map(escapeCsvCell).join(","));
  return `${[headerLine, ...rowLines].join("\n")}\n`;
}

function makeUniqueColumnName(headers, desired) {
  const base = (desired || "llama_cpp_response").trim() || "llama_cpp_response";
  const existing = new Set(headers.map((h) => String(h || "").trim().toLowerCase()));
  if (!existing.has(base.toLowerCase())) return base;

  let i = 2;
  while (existing.has(`${base}_${i}`.toLowerCase())) i++;
  return `${base}_${i}`;
}

function resolveTxtPath(inputDir, fileName) {
  const trimmed = String(fileName || "").trim();
  if (!trimmed) return null;

  const direct = path.join(inputDir, trimmed);
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;

  const parsed = path.parse(trimmed);
  const txtName = `${parsed.name}.txt`;
  const txtPath = path.join(inputDir, txtName);
  if (fs.existsSync(txtPath) && fs.statSync(txtPath).isFile()) return txtPath;

  if (!parsed.ext) {
    const noExtTxt = path.join(inputDir, `${trimmed}.txt`);
    if (fs.existsSync(noExtTxt) && fs.statSync(noExtTxt).isFile()) return noExtTxt;
  }

  return null;
}

function applyTemplate(promptTemplate, fileName, fileContent) {
  const template = String(promptTemplate || "").trim();
  if (!template) return "";

  const hasFileName = template.includes("{{file_name}}");
  const hasFileContent = template.includes("{{file_content}}");

  let output = template.replaceAll("{{file_name}}", fileName).replaceAll("{{file_content}}", fileContent);

  if (!hasFileName || !hasFileContent) {
    output = [
      output,
      "",
      `File name: ${fileName}`,
      "",
      "File content:",
      fileContent
    ].join("\n");
  }

  return output.trim();
}

function parseAssistantContent(messageContent) {
  if (typeof messageContent === "string") return messageContent.trim();

  if (Array.isArray(messageContent)) {
    const joined = messageContent
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part.text === "string") return part.text;
        if (part && typeof part.content === "string") return part.content;
        return "";
      })
      .join("\n")
      .trim();
    return joined;
  }

  return "";
}

function normalizeAnswer(value) {
  return String(value || "").replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
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

function requestJson(urlString, apiKey, timeoutMs, payload) {
  return new Promise((resolve, reject) => {
    let urlObj;
    try {
      urlObj = new URL(urlString);
    } catch (err) {
      reject(new Error(`Invalid URL: ${urlString}`));
      return;
    }

    const body = JSON.stringify(payload);
    const isHttps = urlObj.protocol === "https:";
    const transport = isHttps ? https : http;

    const req = transport.request(
      {
        method: "POST",
        protocol: urlObj.protocol,
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: `${urlObj.pathname}${urlObj.search}`,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          Authorization: `Bearer ${apiKey}`
        }
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          const statusCode = res.statusCode || 0;
          if (statusCode < 200 || statusCode >= 300) {
            reject(new Error(`API error ${statusCode}: ${data.slice(0, 500)}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(new Error(`Invalid JSON response: ${String(err.message || err)}`));
          }
        });
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timeout after ${timeoutMs} ms`));
    });
    req.on("error", (err) => reject(err));
    req.write(body);
    req.end();
  });
}

async function generateResponse({
  endpoint,
  apiKey,
  model,
  fileName,
  systemPrompt,
  userPrompt,
  timeoutMs,
  maxRetries,
  temperature,
  maxTokens
}) {
  const payload = {
    model,
    messages: systemPrompt
      ? [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      : [{ role: "user", content: userPrompt }]
  };

  if (temperature !== null) payload.temperature = temperature;
  if (maxTokens !== null) payload.max_tokens = maxTokens;

  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const attemptNo = attempt + 1;
    try {
      const data = await requestJson(endpoint, apiKey, timeoutMs, payload);
      const content = parseAssistantContent(data?.choices?.[0]?.message?.content);
      const normalized = normalizeAnswer(content);
      if (!normalized) {
        throw new Error("Model returned an empty response");
      }
      return normalized;
    } catch (err) {
      lastError = err;
      const message = String(err?.message || err);
      if (attempt >= maxRetries) {
        logError(`API failed for ${fileName} after ${attemptNo}/${maxRetries + 1} attempts: ${message}`);
        break;
      }
      logWarn(`Retry ${attemptNo}/${maxRetries + 1} for ${fileName}: ${message}`);
    }
  }
  throw lastError || new Error("Unknown API error");
}

async function main() {
  const projectRoot = process.cwd();
  const envPath = path.resolve(projectRoot, process.argv[2] || "llamacpp.env");
  const envLoaded = loadEnvFile(envPath);
  if (!envLoaded) {
    throw new Error(`Missing env file: ${envPath}`);
  }

  const csvPath = path.resolve(projectRoot, process.env.LLAMACPP_INPUT_CSV || "output_llamacpp.csv");
  const inputDir = path.resolve(
    projectRoot,
    process.env.LLAMACPP_INPUT_DIR ||
      "C:\\Users\\hamza\\Downloads\\CODING\\WBCSD_RESOURCE_DIRECTORY\\txt_inputs"
  );
  const promptYamlPath = path.resolve(projectRoot, process.env.LLAMACPP_PROMPT_FILE || "llama_cpp.yaml");

  const baseUrl = (process.env.LLAMACPP_BASE_URL || "http://192.168.1.107:8080").replace(/\/+$/, "");
  const endpoint = `${baseUrl}/v1/chat/completions`;
  const apiKey = process.env.LLAMACPP_API_KEY || "";
  const model = process.env.LLAMACPP_MODEL || "gpt-oss-20b";
  const timeoutMs = Number.parseInt(process.env.LLAMACPP_TIMEOUT_MS || "120000", 10);
  const configuredMaxRetries = Number.parseInt(process.env.LLAMACPP_MAX_RETRIES || "3", 10);
  const maxRetries = Math.max(3, configuredMaxRetries);
  const batchSize = Number.parseInt(process.env.LLAMACPP_BATCH_SIZE || "5", 10);
  const summaryColumnName = "Summary";

  if (!apiKey) {
    throw new Error("Missing LLAMACPP_API_KEY in env");
  }
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV not found: ${csvPath}`);
  }
  if (!fs.existsSync(inputDir)) {
    throw new Error(`Input folder not found: ${inputDir}`);
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000) {
    throw new Error("LLAMACPP_TIMEOUT_MS must be >= 1000");
  }
  if (!Number.isFinite(configuredMaxRetries) || configuredMaxRetries < 0) {
    throw new Error("LLAMACPP_MAX_RETRIES must be >= 0");
  }
  if (!Number.isFinite(batchSize) || batchSize < 1) {
    throw new Error("LLAMACPP_BATCH_SIZE must be >= 1");
  }

  logInfo(`Starting run on ${csvPath}`);
  logInfo(`Batch size: ${batchSize}`);

  const yaml = parseSimpleYaml(promptYamlPath);
  const promptTemplate = String(yaml.prompt || "").trim();
  const systemPrompt = String(yaml.system_prompt || "").trim();
  const temperature = yaml.temperature === undefined ? null : Number.parseFloat(yaml.temperature);
  const maxTokens = yaml.max_tokens === undefined ? null : Number.parseInt(String(yaml.max_tokens), 10);

  if (!promptTemplate) {
    throw new Error(`Prompt is empty in YAML: ${promptYamlPath}`);
  }
  if (temperature !== null && !Number.isFinite(temperature)) {
    throw new Error("YAML field temperature must be a number");
  }
  if (maxTokens !== null && (!Number.isFinite(maxTokens) || maxTokens < 1)) {
    throw new Error("YAML field max_tokens must be a positive integer");
  }

  const csvText = fs.readFileSync(csvPath, "utf8");
  const parsed = parseCSV(csvText);
  const headers = parsed.headers;
  const rows = parsed.rows;

  if (headers.length === 0) {
    throw new Error("CSV is empty");
  }

  const normalizedHeader = headers.map((h) => normalizeCell(h).toLowerCase());
  const fileIndex = normalizedHeader.indexOf("file");
  if (fileIndex === -1) {
    throw new Error(`CSV must include a 'file' column. Current header: ${headers.join(", ")}`);
  }

  let responseIndex = normalizedHeader.indexOf(summaryColumnName.toLowerCase());
  if (responseIndex === -1) {
    headers.push(summaryColumnName);
    responseIndex = headers.length - 1;
  }
  for (const row of rows) {
    while (row.length < headers.length) row.push("");
  }

  const rowsWithMissingSummary = rows.filter((row) => {
    const fileName = normalizeCell(row[fileIndex]);
    return fileName && isBlankResponse(row[responseIndex]);
  }).length;
  logInfo(`Rows to process (blank Summary): ${rowsWithMissingSummary}`);

  function flush() {
    fs.writeFileSync(csvPath, toCSV(headers, rows), "utf8");
  }

  process.on("SIGINT", () => {
    logWarn("Interrupted. Saving progress...");
    try {
      flush();
      logInfo("Progress saved.");
    } catch (err) {
      logError(`Failed to save progress: ${String(err?.message || err)}`);
    }
    process.exit(130);
  });

  let successCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let processedWithApi = 0;
  const rowsToProcess = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowLabel = `${i + 1}/${rows.length}`;
    const fileName = String(row[fileIndex] || "").trim();
    const displayFile = fileName || "(missing file)";
    const existingSummary = row[responseIndex];

    if (!isBlankResponse(existingSummary)) {
      skippedCount++;
      logInfo(`SKIP [${rowLabel}] ${displayFile} (Summary already populated)`);
      continue;
    }

    if (!fileName) {
      row[responseIndex] = "ERROR: Missing file name in CSV row";
      skippedCount++;
      logWarn(`SKIP [${rowLabel}] ${displayFile} (file column is empty)`);
      continue;
    }

    rowsToProcess.push(i);
  }

  logInfo(`Queued for API batches: ${rowsToProcess.length}`);

  async function processRowByIndex(i) {
    const row = rows[i];
    const rowLabel = `${i + 1}/${rows.length}`;
    const fileName = String(row[fileIndex] || "").trim();

    logInfo(`PROCESSING [${rowLabel}] ${fileName}`);
    const txtPath = resolveTxtPath(inputDir, fileName);
    if (!txtPath) {
      row[responseIndex] = `ERROR: txt file not found for ${fileName}`;
      failedCount++;
      logError(`FAILED [${rowLabel}] ${fileName} (txt not found)`);
      return;
    }

    let fileContent;
    try {
      fileContent = fs.readFileSync(txtPath, "utf8");
    } catch (err) {
      row[responseIndex] = `ERROR: cannot read file ${path.basename(txtPath)} (${String(
        err.message || err
      )})`;
      failedCount++;
      logError(`FAILED [${rowLabel}] ${fileName} (cannot read txt)`);
      return;
    }

    const userPrompt = applyTemplate(promptTemplate, fileName, fileContent);
    if (!userPrompt) {
      row[responseIndex] = "ERROR: empty prompt after template rendering";
      failedCount++;
      logError(`FAILED [${rowLabel}] ${fileName} (empty prompt)`);
      return;
    }

    try {
      const answer = await generateResponse({
        endpoint,
        apiKey,
        model,
        fileName,
        systemPrompt,
        userPrompt,
        timeoutMs,
        maxRetries,
        temperature,
        maxTokens
      });
      row[responseIndex] = answer;
      successCount++;
      processedWithApi++;
      logInfo(`SUCCESS [${rowLabel}] ${fileName}`);
    } catch (err) {
      row[responseIndex] = `ERROR: ${String(err.message || err)}`;
      failedCount++;
      logError(`FAILED [${rowLabel}] ${fileName} (${String(err.message || err)})`);
    }
  }

  const totalBatches = Math.ceil(rowsToProcess.length / batchSize);
  for (let start = 0; start < rowsToProcess.length; start += batchSize) {
    const batchNo = Math.floor(start / batchSize) + 1;
    const batchIndexes = rowsToProcess.slice(start, start + batchSize);
    logInfo(`BATCH ${batchNo}/${totalBatches} start (${batchIndexes.length} rows)`);
    await Promise.all(batchIndexes.map((idx) => processRowByIndex(idx)));
    flush();
    logInfo(`BATCH ${batchNo}/${totalBatches} done`);
  }

  flush();
  logInfo(`Completed. success=${successCount}, failed=${failedCount}, skipped=${skippedCount}, api_calls=${processedWithApi}`);
}

main().catch((err) => {
  console.error(String(err.message || err));
  process.exit(1);
});
