import fs from 'node:fs';
const css=fs.readFileSync('src/design-system/waiter-pos.css','utf8');
const view=fs.readFileSync('src/components/WaiterPOSView.tsx','utf8');
const main=fs.readFileSync('src/main.tsx','utf8');
const checks=[
  ['stylesheet imported',main.includes("./design-system/waiter-pos.css")],
  ['waiter root styled',css.includes('.waiter-pos')],
  ['idle screen styled',css.includes('.waiter-idle')],
  ['keypad styled',css.includes('.keypad')],
  ['menu cards styled',css.includes('.menu-card')],
  ['order panel styled',css.includes('.order-panel')],
  ['mobile breakpoint',css.includes('@media (max-width:900px)')],
  ['small mobile breakpoint',css.includes('@media (max-width:560px)')],
  ['reduced motion',css.includes('prefers-reduced-motion')],
  ['business logic remains in view',view.includes('sendOrder=async')],
  ['no second order core',!css.includes('api.')],
  ['tokens consumed',css.includes('var(--boom-gold)') && css.includes('var(--boom-surface-soft)')],
];
for(const [name,ok] of checks) console.log(`${ok?'PASS':'FAIL'} ${name}`);
if(checks.some(([,ok])=>!ok)) process.exit(1);
console.log(`Stage 35.1 static: ${checks.length}/${checks.length} PASS`);
