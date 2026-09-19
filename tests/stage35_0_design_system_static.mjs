import fs from 'node:fs';

const css = fs.readFileSync('src/design-system/tokens.css','utf8');
const index = fs.readFileSync('src/index.css','utf8');
const readme = fs.readFileSync('src/design-system/README.md','utf8');

const checks = [
  ['tokens file exists', css.length > 500],
  ['index imports tokens', index.includes('@import "./design-system/tokens.css";')],
  ['graphite foundation', css.includes('--boom-bg: #0b0f17')],
  ['gold accent token', css.includes('--boom-gold: #f59e0b')],
  ['semantic success and danger', css.includes('--boom-success') && css.includes('--boom-danger')],
  ['motion tokens', css.includes('--boom-motion-fast') && css.includes('--boom-motion-slow')],
  ['reduced motion support', css.includes('prefers-reduced-motion: reduce')],
  ['focus treatment', css.includes('.boom-focusable:focus-visible')],
  ['surface primitive', css.includes('.boom-surface')],
  ['35.x boundary documented', readme.includes('35.9 Unified BOOM OS UX')],
];
for (const [name, ok] of checks) {
  if (!ok) { console.error(`FAIL ${name}`); process.exit(1); }
  console.log(`PASS ${name}`);
}
console.log(`Stage 35.0 design-system static: ${checks.length}/${checks.length} passed`);
