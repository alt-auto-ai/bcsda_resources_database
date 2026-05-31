// analyze-pdfs-theme.js
// Script to identify the main theme of PDFs in the Inputs directory using OpenAI Responses API models
// Outputs results to output.csv (column: theme)

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import pLimit from 'p-limit';
import { buildResponsesCreateParams, resolveModelConfig } from './openai-model-config.js';

dotenv.config();

const INPUT_DIR = path.join(process.cwd(), 'Inputs');
const OUTPUT_CSV = path.join(process.cwd(), 'output.csv');
const PROMPT_FILE = path.join(process.cwd(), 'prompt_theme.yaml');

const API_KEY = process.env.OPENAI_API_KEY;
const API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';
const MODEL_CONFIG = resolveModelConfig(process.env);
const MODEL = MODEL_CONFIG.model;

if (!API_KEY) {
  console.error('Missing OPENAI_API_KEY in .env');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: API_KEY, baseURL: API_BASE });

async function main() {
  function flushResults() {
    const csv = csvHeader.join(',') + '\n' + results.map(r => r ? csvHeader.map(h => r[h] || '').join(',') : '').filter(Boolean).join('\n');
    fs.writeFileSync(OUTPUT_CSV, csv, 'utf8');
    console.log(`\n--- Partial results written to ${OUTPUT_CSV} ---`);
  }

  process.on('SIGINT', () => {
    console.log('\nSIGINT received. Flushing results and exiting...');
    flushResults();
    process.exit(0);
  });

  console.log('--- PDF Theme Identification Script ---');
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

  // Read the existing CSV if present
  let csvRows = [];
  let csvHeader = ['file', 'theme'];
  if (fs.existsSync(OUTPUT_CSV)) {
    const csvLines = fs.readFileSync(OUTPUT_CSV, 'utf8').split(/\r?\n/);
    if (csvLines[0]) csvHeader = csvLines[0].split(',');
    if (!csvHeader.includes('theme')) csvHeader.push('theme');
    csvRows = csvLines.slice(1).filter(Boolean).map(line => line.split(','));
  }

  // Map file names to row indices for quick lookup
  const fileToRow = {};
  csvRows.forEach((row, idx) => {
    fileToRow[row[0]] = idx;
  });

  // Get all PDF files in Inputs, sorted
  const pdfFiles = fs.readdirSync(INPUT_DIR)
    .filter(f => f.toLowerCase().endsWith('.pdf'))
    .sort();

  console.log(`Found ${pdfFiles.length} PDF files to process.`);

  // Prepare results array (preserve existing responses)
  const results = pdfFiles.map((fileName) => {
    let row = fileName in fileToRow ? csvRows[fileToRow[fileName]] : null;
    let rowObj = { file: fileName };
    csvHeader.forEach((h, i) => { if (h && row && row[i]) rowObj[h] = row[i]; });
    if (!rowObj['theme']) rowObj['theme'] = '';
    return rowObj;
  });

  const limit = pLimit(MODEL_CONFIG.concurrency);

  const tasks = pdfFiles.map((fileName, idx) => limit(async () => {
    // Only process if theme is blank or missing
    if (results[idx]['theme'] && results[idx]['theme'].trim() !== '') return;
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
      let answer = (response.output_text || '').trim();
      if (!answer) answer = 'Unknown';
      results[idx]['theme'] = answer;
      console.log(`  Model response: ${answer}`);
    } catch (err) {
      console.error(`  Error processing ${fileName}:`, err.message || err);
      results[idx]['theme'] = 'Error';
    }
  }));

  await Promise.all(tasks);
  flushResults();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
