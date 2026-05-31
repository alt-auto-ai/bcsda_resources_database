#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

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
}

loadEnvFile(path.resolve(process.cwd(), ".env"));

const inputPath = process.argv[2] || "input.csv";
const resolvedPath = path.resolve(process.cwd(), inputPath);

const baseUrl = process.env.VLLM_BASE_URL || "http://192.168.1.107:8000";
const apiKey = process.env.VLLM_API_KEY;
const model = process.env.VLLM_MODEL;

if (!apiKey) {
  console.error("Missing VLLM_API_KEY in .env or environment.");
  process.exit(1);
}

if (!model) {
  console.error("Missing VLLM_MODEL in .env or environment.");
  process.exit(1);
}

function parseCSVLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      fields.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  fields.push(current);
  return fields;
}

function parseCSV(content) {
  const lines = content.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = parseCSVLine(lines[0]);
  const rows = lines.slice(1).map((line) => parseCSVLine(line));
  return { headers, rows };
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

function tryExtractJoke(content) {
  const trimmed = (content || "").trim();
  if (!trimmed) return "";

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed.joke === "string") {
      return parsed.joke.trim();
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
    } catch (_) {
      // fall through
    }
  }

  return trimmed.replace(/^"|"$/g, "").trim();
}

async function generateJoke(item) {
  const payload = {
    model,
    temperature: 0.7,
    max_tokens: 80,
    messages: [
      {
        role: "system",
        content:
          'You are a joke writer. Respond with strict JSON only in this format: {"joke":"..."}. Keep it short and safe.'
      },
      {
        role: "user",
        content: `Write one short joke about: ${item}`
      }
    ]
  };

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error ${response.status}: ${body}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  return tryExtractJoke(content);
}

async function main() {
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`CSV file not found: ${resolvedPath}`);
  }

  const csvText = fs.readFileSync(resolvedPath, "utf8");
  const { headers, rows } = parseCSV(csvText);

  if (headers.length === 0) {
    throw new Error("CSV is empty.");
  }

  const itemIndex = headers.findIndex((h) => {
    const key = h.trim().toLowerCase();
    return key === "item" || key === "items";
  });

  if (itemIndex === -1) {
    throw new Error('Missing required column: "item" or "items"');
  }

  let jokeIndex = headers.findIndex((h) => h.trim().toLowerCase() === "joke");
  if (jokeIndex === -1) {
    headers.push("joke");
    jokeIndex = headers.length - 1;
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    while (row.length < headers.length) row.push("");

    const item = (row[itemIndex] || "").trim();
    if (!item) {
      row[jokeIndex] = "";
      continue;
    }

    process.stdout.write(`Generating joke ${i + 1}/${rows.length} for: ${item} ... `);
    try {
      const joke = await generateJoke(item);
      row[jokeIndex] = joke;
      process.stdout.write("done\n");
    } catch (err) {
      row[jokeIndex] = `ERROR: ${err.message}`;
      process.stdout.write("failed\n");
    }
  }

  const output = toCSV(headers, rows);
  fs.writeFileSync(resolvedPath, output, "utf8");
  console.log(`Updated file: ${resolvedPath}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
