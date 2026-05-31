// Extract first 5 pages of each PDF in Inputs and save as .txt in txt_inputs
// Dependency: npm install pdfjs-dist

const fs = require('fs');
const path = require('path');

const INPUT_DIR = path.join(process.cwd(), 'Inputs');
const OUTPUT_DIR = path.join(process.cwd(), 'txt_inputs');
const MAX_PAGES = 5;

function normalizeText(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

async function extractFirstPagesToText(pdfPath, maxPages) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const loadingTask = getDocument({ data });
  const pdf = await loadingTask.promise;

  const pageLimit = Math.min(maxPages, pdf.numPages);
  const chunks = [];

  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = normalizeText(
      textContent.items.map(item => ('str' in item ? item.str : '')).join(' ')
    );

    chunks.push(`--- Page ${pageNumber} ---`);
    chunks.push(pageText);
    chunks.push('');
  }

  return chunks.join('\n').trim() + '\n';
}

async function main() {
  if (!fs.existsSync(INPUT_DIR)) {
    console.error(`Input folder not found: ${INPUT_DIR}`);
    process.exit(1);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const pdfFiles = fs.readdirSync(INPUT_DIR)
    .filter(file => file.toLowerCase().endsWith('.pdf'))
    .sort((a, b) => a.localeCompare(b));

  console.log(`Found ${pdfFiles.length} PDF file(s).`);

  for (let i = 0; i < pdfFiles.length; i++) {
    const fileName = pdfFiles[i];
    const pdfPath = path.join(INPUT_DIR, fileName);
    const txtPath = path.join(OUTPUT_DIR, `${path.parse(fileName).name}.txt`);

    try {
      console.log(`[${i + 1}/${pdfFiles.length}] ${fileName}`);
      const text = await extractFirstPagesToText(pdfPath, MAX_PAGES);
      fs.writeFileSync(txtPath, text, 'utf8');
    } catch (err) {
      console.error(`Failed: ${fileName} -> ${err.message || err}`);
    }
  }

  console.log(`Done. Text files written to: ${OUTPUT_DIR}`);
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
