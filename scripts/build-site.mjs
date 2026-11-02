// Builds the GitHub Pages site (https://itsadithyakv.github.io/Amply-musicplayer/) into an output
// folder: the home page from site/home.html and the privacy policy from PRIVACY.md, both wrapped in
// site/template.html. PRIVACY.md stays the only copy of the policy; the workflow converts it to HTML
// with marked and passes that file in.
//
//   npx --yes marked@15.0.12 -i PRIVACY.md -o privacy.html
//   node scripts/build-site.mjs privacy.html _site

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [privacyHtmlPath, outDir = '_site'] = process.argv.slice(2);
if (!privacyHtmlPath) {
  console.error('usage: node scripts/build-site.mjs <privacy.html> [outDir]');
  process.exit(1);
}

const template = readFileSync(join(repo, 'site', 'template.html'), 'utf8');

const page = ({ title, description, root, content }) =>
  template
    .replaceAll('{{title}}', title)
    .replaceAll('{{description}}', description)
    .replaceAll('{{root}}', root)
    .replace('{{content}}', () => content.trim());

const write = (path, html) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, html);
};

const out = resolve(outDir);
write(
  join(out, 'index.html'),
  page({
    title: 'Amply Music Player',
    description: 'A music player for the songs already on your PC.',
    root: './',
    content: readFileSync(join(repo, 'site', 'home.html'), 'utf8'),
  }),
);
write(
  join(out, 'privacy', 'index.html'),
  page({
    title: 'Amply Privacy Policy',
    description: 'What Amply Music Player keeps on your PC, what it looks up online, and what a bug report contains.',
    root: '../',
    content: readFileSync(privacyHtmlPath, 'utf8'),
  }),
);
copyFileSync(join(repo, 'src-tauri', 'icons', '128x128.png'), join(out, 'amply.png'));
console.log(`Site written to ${out}`);
