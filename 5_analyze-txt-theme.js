// analyze-txt-theme.js
// Script to analyze TXT files using prompt_theme.yaml and write results to output.csv

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import pLimit from 'p-limit';
import { buildResponsesCreateParams, resolveModelConfig } from './openai-model-config.js';

dotenv.config();

const INPUT_DIR = 'C:\\Users\\hamza\\Downloads\\CODING\\WBCSD_RESOURCE_DIRECTORY\\txt_inputs';
const OUTPUT_CSV = path.join(process.cwd(), 'output.csv');
const PROMPT_FILE = path.join(process.cwd(), 'prompt_theme.yaml');
const RESPONSE_COLUMN = 'theme';

const API_KEY = process.env.OPENAI_API_KEY;
const API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';
const MODEL_CONFIG = resolveModelConfig(process.env);
const MODEL = MODEL_CONFIG.model;

if (!API_KEY) {
  console.error('Missing OPENAI_API_KEY in .env');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: API_KEY, baseURL: API_BASE });

function normalizeCell(value) {
  return String(value ?? '').replace(/\r?\n/g, ' ').trim();
}

function normalizeModelAnswer(value) {
  return normalizeCell(value).replace(/\s*,+\s*$/g, '').trim();
}

function isBlankValue(value) {
  const normalized = normalizeModelAnswer(value);
  return normalized === '' || normalized === '""' || /^,+$/.test(normalizeCell(value));
}

function csvEscape(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function parseCsvLine(line) {
  const input = String(line ?? '');
  const cells = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"') {
      if (inQuotes && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      cells.push(cell);
      cell = '';
      continue;
    }
    cell += char;
  }
  cells.push(cell);
  return cells;
}

function formatErrorMessage(err) {
  const message = err?.error?.message || err?.message || String(err || 'Unknown error');
  return normalizeCell(message) || 'Unknown error';
}

function resolveTxtPath(fileName) {
  const parsed = path.parse(fileName);
  const txtPath = path.join(INPUT_DIR, `${parsed.name}.txt`);
  if (fs.existsSync(txtPath)) return txtPath;
  return null;
}

async function main() {
  let header = [];
  let rows = [];
  let updatesCount = 0;

  function flushResults() {
    const csv = [header, ...rows]
      .map((row) => row.map(csvEscape).join(','))
      .join('\n');
    fs.writeFileSync(OUTPUT_CSV, csv, 'utf8');
    console.log(`\n--- Partial results written to ${OUTPUT_CSV} ---`);
  }

  process.on('SIGINT', () => {
    console.log('\nSIGINT received. Flushing results and exiting...');
    if (updatesCount > 0) flushResults();
    process.exit(0);
  });

  console.log('--- TXT Theme Script ---');
  console.log(`Model: ${MODEL}`);
  if (MODEL_CONFIG.requestedSeries) {
    console.log(`Model series switch: ${MODEL_CONFIG.requestedSeries}`);
  }
  console.log(`Concurrency: ${MODEL_CONFIG.concurrency}`);
  for (const warning of MODEL_CONFIG.warnings) {
    console.warn(`Config warning: ${warning}`);
  }
  console.log(`Prompt file: ${PROMPT_FILE}`);
  console.log(`Input directory: ${INPUT_DIR}`);
  console.log(`Output CSV: ${OUTPUT_CSV}`);

  // Read prompt strictly from prompt_theme.yaml
  if (!fs.existsSync(PROMPT_FILE)) {
    console.error('Prompt file not found:', PROMPT_FILE);
    process.exit(1);
  }
  const prompt = fs.readFileSync(PROMPT_FILE, 'utf8').trim();
  if (!prompt) {
    console.error('Prompt file is empty:', PROMPT_FILE);
    process.exit(1);
  }
  console.log('Loaded prompt from file.');

  // Read existing output.csv and preserve all existing columns/rows
  if (!fs.existsSync(OUTPUT_CSV)) {
    console.error('output.csv not found. Run the main script first.');
    process.exit(1);
  }
  const csvLines = fs.readFileSync(OUTPUT_CSV, 'utf8').split(/\r?\n/);
  const nonEmptyLines = csvLines.filter((line, index) => index === 0 || line.trim() !== '');
  if (nonEmptyLines.length === 0) {
    console.error('output.csv is empty.');
    process.exit(1);
  }

  header = parseCsvLine(nonEmptyLines[0]);
  rows = nonEmptyLines.slice(1).map(parseCsvLine);

  const normalizedHeader = header.map((h) => normalizeCell(h).toLowerCase());
  const detectedFileColumnIndex = normalizedHeader.indexOf('file');
  const fileColumnIndex = detectedFileColumnIndex >= 0 ? detectedFileColumnIndex : 0;
  let responseColumnIndex = normalizedHeader.indexOf(RESPONSE_COLUMN);
  if (header.length === 0) {
    console.error('output.csv header is missing.');
    process.exit(1);
  }
  if (responseColumnIndex === -1) {
    header.push(RESPONSE_COLUMN);
    responseColumnIndex = header.length - 1;
  }

  rows.forEach((row) => {
    while (row.length < header.length) row.push('');
  });

  const rowsWithBlankTarget = rows.filter((row) => {
    const fileName = normalizeCell(row[fileColumnIndex]);
    return fileName && isBlankValue(row[responseColumnIndex]);
  }).length;
  console.log(`Rows with blank ${RESPONSE_COLUMN} to process: ${rowsWithBlankTarget}`);
  if (rowsWithBlankTarget === 0) {
    console.log(`No blank ${RESPONSE_COLUMN} cells found. Skipping API calls.`);
    return;
  }

  const limit = pLimit(MODEL_CONFIG.concurrency);
  const tasks = rows.map((row, idx) => limit(async () => {
    const fileName = normalizeCell(row[fileColumnIndex]);
    if (!fileName) return;
    if (!isBlankValue(row[responseColumnIndex])) return;

    const filePath = resolveTxtPath(fileName);
    if (!filePath) {
      row[responseColumnIndex] = 'Error_file_missing';
      updatesCount++;
      console.error(`\n[${idx + 1}/${rows.length}] Missing TXT for: ${fileName}`);
      return;
    }

    console.log(`\n[${idx + 1}/${rows.length}] Processing: ${fileName}`);
    try {
      console.log('  Uploading TXT to OpenAI...');
      const fileUpload = await openai.files.create({
        file: fs.createReadStream(filePath),
        purpose: 'user_data',
      });
      console.log(`  Uploaded. File ID: ${fileUpload.id}`);

      console.log('  Sending prompt to model...');
      const response = await openai.responses.create(buildResponsesCreateParams({
        modelConfig: MODEL_CONFIG,
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_file',
                file_id: fileUpload.id,
              },
              {
                type: 'input_text',
                text: prompt,
              },
            ],
          },
        ],
      }));

      let answer = normalizeModelAnswer(response.output_text || '');
      if (!answer) answer = 'Unknown';
      row[responseColumnIndex] = answer;
      updatesCount++;
      console.log(`  Model response: ${answer}`);
    } catch (err) {
      row[responseColumnIndex] = `Error_${formatErrorMessage(err)}`;
      updatesCount++;
      console.error(`  Error processing ${fileName}:`, err.message || err);
    }
  }));

  await Promise.all(tasks);
  if (updatesCount === 0) {
    console.log(`No blank ${RESPONSE_COLUMN} cells were updated. Skipping file write.`);
    return;
  }
  flushResults();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
