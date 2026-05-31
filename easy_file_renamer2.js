// easy_file_renamer2.js
// Renames files in Inputs to "<number>_document<ext>" while preserving numeric prefix and extension.

import fs from 'fs';
import path from 'path';

const INPUT_DIR = path.join(process.cwd(), 'Inputs');
const PREFIX_REGEX = /^(\d+)_/;

function main() {
  if (!fs.existsSync(INPUT_DIR)) {
    console.error('Inputs directory not found:', INPUT_DIR);
    process.exit(1);
  }

  const files = fs.readdirSync(INPUT_DIR)
    .filter((name) => fs.statSync(path.join(INPUT_DIR, name)).isFile())
    .sort();

  const plans = [];
  const targetNameCounts = new Map();
  const allNamesLower = new Set(files.map((name) => name.toLowerCase()));

  for (const file of files) {
    const match = file.match(PREFIX_REGEX);
    if (!match) {
      console.log(`Skipping (no numeric prefix): ${file}`);
      continue;
    }

    const prefix = match[1];
    const ext = path.extname(file);
    const targetName = `${prefix}_document${ext}`;

    if (file === targetName) {
      console.log(`Already normalized: ${file}`);
      continue;
    }

    plans.push({ oldName: file, targetName });
    const key = targetName.toLowerCase();
    targetNameCounts.set(key, (targetNameCounts.get(key) || 0) + 1);
  }

  const duplicateTargets = [...targetNameCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name]) => name);
  if (duplicateTargets.length > 0) {
    console.error('Aborting: duplicate rename targets detected:');
    duplicateTargets.forEach((name) => console.error(`  - ${name}`));
    process.exit(1);
  }

  const movingAway = new Set(plans.map((p) => p.oldName.toLowerCase()));
  for (const plan of plans) {
    const oldKey = plan.oldName.toLowerCase();
    const targetKey = plan.targetName.toLowerCase();
    const targetExists = allNamesLower.has(targetKey);
    const targetWillMoveAway = movingAway.has(targetKey);
    if (targetExists && targetKey !== oldKey && !targetWillMoveAway) {
      console.error(`Aborting: target already exists and is not being moved away: ${plan.targetName}`);
      process.exit(1);
    }
  }

  if (plans.length === 0) {
    console.log('No files needed renaming.');
    return;
  }

  // Two-phase rename avoids conflicts when targets overlap with current names.
  const now = Date.now();
  const staged = plans.map((plan, idx) => {
    const tmpName = `.__tmp_rename__${now}_${idx}__${plan.oldName}`;
    return { ...plan, tmpName };
  });

  for (const step of staged) {
    fs.renameSync(path.join(INPUT_DIR, step.oldName), path.join(INPUT_DIR, step.tmpName));
  }

  for (const step of staged) {
    fs.renameSync(path.join(INPUT_DIR, step.tmpName), path.join(INPUT_DIR, step.targetName));
    console.log(`Renamed: ${step.oldName} -> ${step.targetName}`);
  }

  console.log(`Done. Renamed ${staged.length} file(s).`);
}

main();
