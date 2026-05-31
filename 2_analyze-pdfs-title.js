// analyze-pdfs-title.js
// Script to extract document titles from PDFs using a separate prompt and append results to output.csv

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
const PROMPT_FILE = path.join(process.cwd(), 'prompt_title.yaml');

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

function isBlankValue(value) {
  return normalizeCell(value) === '';
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

async function main() {
    let header = [];
    let rows = [];
    let updatesCount = 0;

    function flushResults() {
      const newCsv = [header, ...rows]
        .map((row) => row.map(csvEscape).join(','))
        .join('\n');
      fs.writeFileSync(OUTPUT_CSV, newCsv, 'utf8');
      console.log(`\n--- Partial results written to ${OUTPUT_CSV} ---`);
    }

    process.on('SIGINT', () => {
      console.log('\nSIGINT received. Flushing results and exiting...');
      flushResults();
      process.exit(0);
    });
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

  console.log(`Model: ${MODEL}`);
  if (MODEL_CONFIG.requestedSeries) {
    console.log(`Model series switch: ${MODEL_CONFIG.requestedSeries}`);
  }
  console.log(`Concurrency: ${MODEL_CONFIG.concurrency}`);
  for (const warning of MODEL_CONFIG.warnings) {
    console.warn(`Config warning: ${warning}`);
  }

  // Read the existing CSV
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
  const fileColumnIndex = normalizedHeader.indexOf('file');
  let titleColumnIndex = normalizedHeader.indexOf('title');
  if (fileColumnIndex === -1) {
    console.error(`Missing 'file' column in CSV header: ${header.join(',')}`);
    process.exit(1);
  }
  if (titleColumnIndex === -1) {
    header.push('title');
    titleColumnIndex = header.length - 1;
  }
  rows.forEach((row) => {
    while (row.length < header.length) row.push('');
  });

  const rowsWithBlankTitle = rows.filter((row) => {
    const fileName = normalizeCell(row[fileColumnIndex]);
    return fileName && isBlankValue(row[titleColumnIndex]);
  }).length;
  console.log(`Rows with blank title to process: ${rowsWithBlankTitle}`);
  if (rowsWithBlankTitle === 0) {
    console.log('No blank title cells found. Skipping API calls.');
    return;
  }

  const limit = pLimit(MODEL_CONFIG.concurrency);
  const tasks = rows.map((row, idx) => limit(async () => {
    const fileName = normalizeCell(row[fileColumnIndex]);
    if (!fileName) return;
    if (!isBlankValue(row[titleColumnIndex])) return;
    const filePath = path.join(INPUT_DIR, fileName);
    if (!fs.existsSync(filePath)) {
      console.error(`\n[${idx + 1}/${rows.length}] File not found in Inputs, skipping: ${fileName}`);
      return;
    }
    console.log(`\n[${idx + 1}/${rows.length}] Processing: ${fileName}`);
    try {
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
      let title = (response.output_text || '').trim().replace(/\r|\n/g, ' ');
      row[titleColumnIndex] = title;
      updatesCount++;
      console.log(`  Model response: ${title}`);
    } catch (err) {
      console.error(`  Error processing ${fileName}:`, err.message || err);
      row[titleColumnIndex] = 'Error';
      updatesCount++;
    }
  }));
  await Promise.all(tasks);
  if (updatesCount === 0) {
    console.log('No blank title cells were updated. Skipping file write.');
    return;
  }
  flushResults();
  console.log(`Titles appended to ${OUTPUT_CSV}`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
