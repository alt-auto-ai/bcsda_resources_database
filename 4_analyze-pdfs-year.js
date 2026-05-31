// analyze-pdfs-year.js
// Script to extract the publication year from PDFs using a separate prompt and append results to output.csv

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
const PROMPT_FILE = path.join(process.cwd(), 'prompt_year.yaml');

const API_KEY = process.env.OPENAI_API_KEY;
const API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';
const MODEL_CONFIG = resolveModelConfig(process.env);

if (!API_KEY) {
  console.error('Missing OPENAI_API_KEY in .env');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: API_KEY, baseURL: API_BASE });

async function main() {
  // Read prompt
  let prompt = "What year was this document published? Return only the year as a 4-digit number. If unknown, return 'Unknown'.";
  if (fs.existsSync(PROMPT_FILE)) {
    const filePrompt = fs.readFileSync(PROMPT_FILE, 'utf8').trim();
    if (filePrompt) prompt = filePrompt;
  }

  // Read the existing CSV
  if (!fs.existsSync(OUTPUT_CSV)) {
    console.error('output.csv not found. Run the main script first.');
    process.exit(1);
  }
  const csvLines = fs.readFileSync(OUTPUT_CSV, 'utf8').split(/\r?\n/);
  const header = csvLines[0].split(',');
  const rows = csvLines.slice(1).filter(Boolean).map(line => line.split(','));

  // Add new column header
  header.push('Year');

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
    const filePath = path.join(INPUT_DIR, fileName);
    console.log(`\n[${idx + 1}/${pdfFiles.length}] Processing: ${fileName}`);
    let fileUpload;
    try {
      console.log('  Uploading PDF to OpenAI...');
      fileUpload = await openai.files.create({
        file: fs.createReadStream(filePath),
        purpose: 'user_data',
      });
      console.log(`  Uploaded. File ID: ${fileUpload.id}`);
    } catch (err) {
      console.error(`  Error uploading ${fileName}:`, err.message || err);
      rows[fileToRow[fileName]].push('Error');
      return;
    }

    let response, year;
    let success = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`  Sending prompt to model... (attempt ${attempt})`);
        response = await openai.responses.create(buildResponsesCreateParams({
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
        year = (response.output_text || '').trim().replace(/\r|\n/g, ' ');
        rows[fileToRow[fileName]].push(year);
        console.log(`  Model response: ${year}`);
        success = true;
        break;
      } catch (err) {
        console.error(`  Error processing ${fileName} (attempt ${attempt}):`, err.message || err);
        if (attempt === 3) {
          rows[fileToRow[fileName]].push('Error');
        } else {
          await new Promise(res => setTimeout(res, 1000 * attempt)); // backoff
        }
      }
    }
  }));
  await Promise.all(tasks);

  // Write updated CSV
  const newCsv = [header.join(',')].concat(rows.map(r => r.join(','))).join('\n');
  fs.writeFileSync(OUTPUT_CSV, newCsv, 'utf8');
  console.log(`\nYears appended to ${OUTPUT_CSV}`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
