// analyze-pdfs-summary.js
// Script to extract a 50-word summary from PDFs using a separate prompt and append results to output.csv

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
const PROMPT_FILE = path.join(process.cwd(), 'prompt_summary.yaml');

const API_KEY = process.env.OPENAI_API_KEY;
const API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';
const MODEL_CONFIG = resolveModelConfig(process.env);

if (!API_KEY) {
  console.error('Missing OPENAI_API_KEY in .env');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: API_KEY, baseURL: API_BASE });

async function main() {
    function flushResults() {
      const newCsv = [header.join(',')].concat(rows.map(r => r.join(','))).join('\n');
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

  // Read the existing CSV
  if (!fs.existsSync(OUTPUT_CSV)) {
    console.error('output.csv not found. Run the main script first.');
    process.exit(1);
  }
  const csvLines = fs.readFileSync(OUTPUT_CSV, 'utf8').split(/\r?\n/);
  const header = csvLines[0].split(',');
  const rows = csvLines.slice(1).filter(Boolean).map(line => line.split(','));

  // Add new column header if not present
  if (!header.includes('Summary')) header.push('Summary');

  // Map file names to row indices for quick lookup
  const fileToRow = {};
  rows.forEach((row, idx) => {
    fileToRow[row[0]] = idx;
  });

  // Get all PDF files in Inputs, sorted
  const pdfFiles = fs.readdirSync(INPUT_DIR)
    .filter(f => f.toLowerCase().endsWith('.pdf'))
    .sort();

  const limit = pLimit(MODEL_CONFIG.concurrency);
  const tasks = pdfFiles.map((fileName, idx) => limit(async () => {
    if (!(fileName in fileToRow)) return;
    // Only process if Summary cell is blank or missing
    if (rows[fileToRow[fileName]][header.indexOf('Summary')] && rows[fileToRow[fileName]][header.indexOf('Summary')].trim() !== '') return;
    const filePath = path.join(INPUT_DIR, fileName);
    console.log(`\n[${idx + 1}/${pdfFiles.length}] Processing: ${fileName}`);
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
      let summary = (response.output_text || '').trim().replace(/\r|\n/g, ' ');
      rows[fileToRow[fileName]][header.indexOf('Summary')] = summary;
      console.log(`  Model response: ${summary}`);
    } catch (err) {
      console.error(`  Error processing ${fileName}:`, err.message || err);
      rows[fileToRow[fileName]][header.indexOf('Summary')] = 'Error';
    }
  }));
  await Promise.all(tasks);
  flushResults();
  console.log(`Summaries appended to ${OUTPUT_CSV}`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
