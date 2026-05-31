// easy_file_renamer.js
// Adds a sequential numeric prefix to all files in the Inputs directory, preserving order

import fs from 'fs';
import path from 'path';

const INPUT_DIR = path.join(process.cwd(), 'Inputs');

function padNumber(num, total) {
  // Pad with zeros if you want e.g. 01_, 02_, ...
  return num.toString();
}

function main() {
  if (!fs.existsSync(INPUT_DIR)) {
    console.error('Inputs directory not found:', INPUT_DIR);
    process.exit(1);
  }
  const files = fs.readdirSync(INPUT_DIR)
    .filter(f => fs.statSync(path.join(INPUT_DIR, f)).isFile())
    .sort();

  files.forEach((file, idx) => {
    const oldPath = path.join(INPUT_DIR, file);
    // Remove existing numeric prefix if present
    const newName = file.replace(/^\d+_/, '');
    const numbered = `${padNumber(idx + 1, files.length)}_${newName}`;
    const newPath = path.join(INPUT_DIR, numbered);
    if (oldPath !== newPath) {
      fs.renameSync(oldPath, newPath);
      console.log(`Renamed: ${file} -> ${numbered}`);
    }
  });
  console.log('All files renamed with sequential prefixes.');
}

main();
