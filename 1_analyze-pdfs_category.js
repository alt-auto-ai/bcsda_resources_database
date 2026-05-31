// analyze-pdfs.js
// Script to analyze PDFs in the Inputs directory using OpenAI Responses API models
// Outputs results to output.csv

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import pLimit from 'p-limit';
import { buildResponsesCreateParams, resolveModelConfig } from './openai-model-config.js';

// Load environment variables
dotenv.config();

const INPUT_DIR = path.join(process.cwd(), 'Inputs');
const OUTPUT_CSV = path.join(process.cwd(), 'output.csv');
const PROMPT_FILE = path.join(process.cwd(), 'prompt_category.yaml');

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

function isBlankResponse(value) {
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

async function main() {
  let csvHeader = [];
  let csvRows = [];

  function flushResults() {
    const csv = [csvHeader, ...csvRows]
      .map((row) => row.map(csvEscape).join(','))
      .join('\n');
    fs.writeFileSync(OUTPUT_CSV, csv, 'utf8');
    console.log(`\n--- Partial results written to ${OUTPUT_CSV} ---`);
  }

  process.on('SIGINT', () => {
    console.log('\nSIGINT received. Flushing results and exiting...');
    flushResults();
    process.exit(0);
  });

  console.log('--- PDF Category Analysis Script ---');
  console.log(`Model: ${MODEL}`);
  if (MODEL_CONFIG.requestedSeries) {
    console.log(`Model series switch: ${MODEL_CONFIG.requestedSeries}`);
  }
  console.log(`Reasoning mode: ${MODEL_CONFIG.reasoningMode}`);
  console.log(`Reasoning enabled: ${MODEL_CONFIG.reasoningEnabled ? `yes (${MODEL_CONFIG.reasoningEffort})` : 'no'}`);
  if (MODEL_CONFIG.textVerbosity) {
    console.log(`Text verbosity: ${MODEL_CONFIG.textVerbosity}`);
  }
  if (typeof MODEL_CONFIG.maxOutputTokens === 'number') {
    console.log(`Max output tokens: ${MODEL_CONFIG.maxOutputTokens}`);
  }
  console.log(`Concurrency: ${MODEL_CONFIG.concurrency}`);
  if (MODEL_CONFIG.reasoningSummary) {
    console.log(`Reasoning summary: ${MODEL_CONFIG.reasoningSummary}`);
  }
  if (MODEL_CONFIG.determinismSeed !== null) {
    console.log(`Determinism seed: ${MODEL_CONFIG.determinismSeed}`);
  }
  if (MODEL_CONFIG.temperature !== null) {
    console.log(`Temperature: ${MODEL_CONFIG.temperature}`);
  }
  if (MODEL_CONFIG.topP !== null) {
    console.log(`Top-p: ${MODEL_CONFIG.topP}`);
  }
  if (MODEL_CONFIG.logprobs !== null) {
    console.log(`Logprobs: ${MODEL_CONFIG.logprobs}`);
  }
  for (const warning of MODEL_CONFIG.warnings) {
    console.warn(`Config warning: ${warning}`);
  }
  console.log(`Prompt file: ${PROMPT_FILE}`);
  console.log(`Input directory: ${INPUT_DIR}`);
  console.log(`Output CSV: ${OUTPUT_CSV}`);

  // Read prompt strictly from YAML file
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


  // Read existing CSV and preserve all columns/rows as-is.
  if (!fs.existsSync(OUTPUT_CSV)) {
    console.error('output.csv not found. Run the file-listing step first.');
    process.exit(1);
  }
  const csvLines = fs.readFileSync(OUTPUT_CSV, 'utf8').split(/\r?\n/);
  const nonEmptyLines = csvLines.filter((line, index) => index === 0 || line.trim() !== '');
  if (nonEmptyLines.length === 0) {
    console.error('output.csv is empty.');
    process.exit(1);
  }

  csvHeader = parseCsvLine(nonEmptyLines[0]);
  csvRows = nonEmptyLines.slice(1).map(parseCsvLine);
  csvRows.forEach((row) => {
    while (row.length < csvHeader.length) row.push('');
  });

  const normalizedHeader = csvHeader.map(h => normalizeCell(h).toLowerCase());
  const fileColumnIndex = normalizedHeader.indexOf('file');
  let responseColumnIndex = normalizedHeader.indexOf('response');
  if (fileColumnIndex === -1) {
    console.error(`Missing 'file' column in CSV header: ${csvHeader.join(',')}`);
    process.exit(1);
  }
  if (responseColumnIndex === -1) {
    csvHeader.push('response');
    responseColumnIndex = csvHeader.length - 1;
    csvRows.forEach((row) => row.push(''));
  }

  const rowsWithMissingResponse = csvRows.filter((row) => {
    const fileName = normalizeCell(row[fileColumnIndex]);
    return fileName && isBlankResponse(row[responseColumnIndex]);
  }).length;
  console.log(`Rows with blank response to process: ${rowsWithMissingResponse}`);

  const limit = pLimit(MODEL_CONFIG.concurrency);

  const tasks = csvRows.map((row, idx) => limit(async () => {
    const fileName = normalizeCell(row[fileColumnIndex]);
    if (!fileName) return;
    if (!isBlankResponse(row[responseColumnIndex])) return;

    const filePath = path.join(INPUT_DIR, fileName);
    if (!fs.existsSync(filePath)) {
      console.error(`\n[${idx + 1}/${csvRows.length}] File not found in Inputs, skipping: ${fileName}`);
      return;
    }

    console.log(`\n[${idx + 1}/${csvRows.length}] Processing: ${fileName} using (${MODEL})`);
    let lastErrorMessage = 'Unknown error';
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`  Attempt ${attempt}/3`);
        console.log('  Uploading PDF to OpenAI...');
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
        console.log(`  Model response: ${answer}`);
        return;
      } catch (err) {
        lastErrorMessage = formatErrorMessage(err);
        console.error(`  Error processing ${fileName} (attempt ${attempt}/3):`, lastErrorMessage);
      }
    }
    row[responseColumnIndex] = `Error_${lastErrorMessage}`;
  }));

  await Promise.all(tasks);
  flushResults();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
