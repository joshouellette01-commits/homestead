// Checks content.json against DESIGN.md's pad rules. Runs before every build.
import { readFileSync } from 'node:fs';
import { layoutFromContent, validateLayout } from '../src/content/layout';
import { parseContent } from '../src/content/load';

const content = parseContent(JSON.parse(readFileSync('src/content/content.json', 'utf8')));
const errors = validateLayout(layoutFromContent(content));

if (errors.length > 0) {
  console.error(`Layout validator: ${errors.length} problem(s) in content.json`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log('Layout validator: content.json passes all pad rules');
