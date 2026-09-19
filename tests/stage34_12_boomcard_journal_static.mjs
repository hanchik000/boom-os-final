// BOOM OS -- Stage 34.12 static source guards: the unified BOOMCARD Operations Journal.
// Guards against a second financial ledger, against the journal writing anything, against
// BOOMBACK/breakfast redemption ever reading as a discount, against BOOMCOIN reading as cash
// revenue, against invented fields, against Float money, and against the cashier/waiter gaining
// journal access merely by holding the permission to execute a BOOMCARD operation.
import fs from 'node:fs';

const failures = []; let checks = 0;
const read = p => fs.readFileSync(p, 'utf8');
function ok(label, cond, detail) { checks++; if (!cond) failures.push(`${label}${detail ? ' -> ' + String(detail).slice(0, 260) : ''}`); }

const journal = read('server/routes/boomcard-journal.ts');
const boomcard = read('server/routes/boomcard.ts');
const serverTs = read('server.ts');
const schema = read('prisma/schema.prisma');
const seed = read('server/seed.ts');
const api = read('src/api.ts');
const view = read('src/components/BoomcardJournalView.tsx');
const sidebar = read('src/components/Sidebar.tsx');
const migration = read('prisma/migrations/20260921000000_stage34_12_boomcard_journal/migration.sql');

// ---------------------------------------------------------------- 1. read model, no new ledger
ok('1. the journal writes nothing at all -- no INSERT, UPDATE or DELETE anywhere in it', !/INSERT INTO|UPDATE |DELETE FROM/.test(journal));
ok('2. it opens no transaction, because it has nothing to commit', !/transaction\(/.test(journal) && !/TxClient/.test(journal));
ok('3. and introduces no new financial ledger model -- only two additive nullable columns on the existing event log', /-- AlterTable/.test(migration) && /ADD COLUMN\s+"menu_item_id" TEXT/.test(migration) && /ADD COLUMN\s+"order_id" TEXT/.test(migration) && !/CREATE TABLE/.test(migration) && !/DROP TABLE|DROP COLUMN/.test(migration));
ok('4. no analytics/rollup/journal TABLE was added to the schema -- only fields on BoomcardEvent', !/^model \w*Journal\b/m.test(schema) && !/^model \w*OperationsLog\b/m.test(schema));
ok('5. the journal reads the SAME three existing sources and nothing else', /FROM boomcoin_ledger bcl/.test(journal) && /FROM boomback_ledger bbl/.test(journal) && /FROM boomcard_events be/.test(journal));
ok('6. every row carries source + source_id -- literally the drill-down back to the original record', /'BOOMCOIN_LEDGER' AS source, bcl\.id AS source_id/.test(journal) && /'BOOMBACK_LEDGER' AS source, bbl\.id AS source_id/.test(journal) && /'BOOMCARD_EVENT' AS source, be\.id AS source_id/.test(journal));

// ---------------------------------------------------------------- 2. the required event types all exist
const REQUIRED_TYPES = ['BOOMBACK_EARNED', 'BOOMBACK_REDEEMED', 'BREAKFAST_GRANTED', 'BREAKFAST_REDEEMED', 'BOOMCOIN_EARNED', 'BOOMCOIN_REDEEMED', 'BIRTHDAY_GIFT_GRANTED', 'BIRTHDAY_GIFT_REDEEMED', 'BOOMCARD_ACTIVATED', 'BOOMCARD_RENEWED', 'BOOMCARD_DEACTIVATED'];
ok('7. all eleven required event types are declared in the journal\'s own type list', REQUIRED_TYPES.every(t => journal.includes(`'${t}'`)));
ok('8. breakfast redemption is a REAL redemption (menu item + order captured), not reinvented here', /be\.menu_item_id, mi\.name_ru AS menu_item_name_ru/.test(journal) && /LEFT JOIN orders o ON o\.id=be\.order_id/.test(journal));
ok('9. birthday-gift redemption is now a real, single-use operation, not a phantom counter', /router\.post\('\/:id\/birthday-gift\/:giftId\/redeem'/.test(boomcard) && /status !== 'GRANTED'/.test(boomcard) && /status='REDEEMED',redeemed_at=\?,redeemed_order_id=\?/.test(boomcard));
ok('10. and it consumes real inventory through the SAME order-item + payment path as breakfast -- no second consumption path', /INSERT INTO order_items \(id,order_id,menu_item_id,title_snapshot,price_snapshot,quantity,subtotal,comment,status,created_at\) VALUES \(\?,\?,\?,\?,0,\?,0,\?,'ACTIVE',\?\)/.test(boomcard));
ok('11. the redemption cannot be replayed against the same gift -- the row itself, not a counter, is what is spent', /if \(gift\.status !== 'GRANTED'\) throw Object\.assign\(new Error\('BIRTHDAY_GIFT_NOT_AVAILABLE'\)/.test(boomcard));

// ---------------------------------------------------------------- 3. do not invent data
ok('12. a field the source row does not carry is NULL, never invented -- no default/fallback text stands in', !/\?\? 'N\/A'|\?\? 'Unknown'|\?\? 'unknown'/.test(journal));
ok('13. breakfast GRANTED carries no menu item (it is a balance grant, not tied to one item) -- honestly absent, not guessed', /BREAKFAST_GRANTED.*statusAfter: 'ACTIVE', quantity: grant/.test(boomcard));
ok('14. there is no separate approver in this architecture, so approver is null rather than restating the operator', /NULL::text AS approver_id, NULL::text AS approver_name/.test(journal) && (journal.match(/NULL::text AS approver_id, NULL::text AS approver_name/g) || []).length === 3);
ok('15. money/quantity columns not applicable to a source are explicit NULL casts, not zero or empty string', (journal.match(/NULL::text AS (amount|boomback_amount|menu_item_id|payment_id|balance_before|balance_after)/g) || []).length >= 4);

// ---------------------------------------------------------------- 4. the four categories, never mixed
ok('16. BOOMBACK redemption is tagged PAYMENT_SETTLEMENT, not a discount', /CASE WHEN bbl\.type='REDEEMED' THEN 'PAYMENT_SETTLEMENT' ELSE 'CUSTOMER_REWARD' END AS event_category/.test(journal));
ok('17. breakfast/birthday-gift REDEMPTION is tagged OPERATIONAL_BENEFIT, distinct from the GRANT (a CUSTOMER_REWARD)', /WHEN be\.type IN \('BREAKFAST_REDEEMED','BIRTHDAY_GIFT_REDEEMED'\) THEN 'OPERATIONAL_BENEFIT'/.test(journal) && /WHEN be\.type IN \('BREAKFAST_GRANTED','BIRTHDAY_GIFT_GRANTED'\) THEN 'CUSTOMER_REWARD'/.test(journal));
ok('18. card lifecycle transitions are tagged LIFECYCLE', /ELSE 'LIFECYCLE'/.test(journal));
ok('19. nothing in the journal or its summary ever sums into a sales/revenue figure', !/net_revenue|cash_sales|SUM\(.*subtotal\)|SUM\(.*final_amount\)/.test(journal));
ok('20. the summary keeps event types and categories apart -- it never collapses them into one total', /GROUP BY event_type, event_category/.test(journal));

// ---------------------------------------------------------------- 5. money is never Float
ok('21. there is no parseFloat and no Number()-based money math -- every figure is a straight SQL cast, no arithmetic at all', !/parseFloat/.test(journal) && !/Number\(/.test(journal));
ok('22. money columns are cast to text directly from the Decimal source column, never coerced through JS arithmetic', /bcl\.qualifying_amount::text AS amount/.test(journal) && /bbl\.amount::text AS boomback_amount/.test(journal));
ok('23. the one arithmetic in the whole module is the summary\'s own SQL SUM/ABS, computed by Postgres, never in JS', /COALESCE\(SUM\(ABS\(COALESCE\(boomback_amount::numeric,0\)\)\),0\)::text/.test(journal));

// ---------------------------------------------------------------- 6. archived customers/cards stay visible
ok('24. the journal never filters on deleted_at/archived -- an archived guest\'s history is never hidden', !/deleted_at IS NULL/.test(journal));

// ---------------------------------------------------------------- 7. pagination + filters + branch isolation
ok('25. filters exist for period, branch, customer/card, event type, operator, order, status, source and search', /req\.query\.start/.test(journal) && /req\.query\.branch_id/.test(journal) && /req\.query\.customer_id/.test(journal) && /req\.query\.boomcard_id/.test(journal) && /req\.query\.event_type/.test(journal) && /req\.query\.operator_id/.test(journal) && /req\.query\.order_id/.test(journal) && /req\.query\.status/.test(journal) && /req\.query\.source/.test(journal) && /req\.query\.search/.test(journal));
ok('26. pagination is real -- page, page_size and a total/total_pages are all computed server-side', /const page = Math\.max\(1,/.test(journal) && /const pageSize = Math\.min\(200,/.test(journal) && /total_pages: Math\.max\(1, Math\.ceil/.test(journal));
ok('27. the role lookup uses a correlated scalar subquery, never a LEFT JOIN onto user_roles -- a JOIN there would fan a multi-role operator into duplicate rows and corrupt both the count and the pagination', (journal.match(/\$\{ROLE_SUBQUERY\(/g) || []).length === 3 && !/LEFT JOIN user_roles/.test(journal));
ok('28. every endpoint is branch-checked with the existing helper', (journal.match(/if \(!b \|\| !allowed\(req, b\)\)/g) || []).length === 2);
ok('29. the journal router is mounted BEFORE boomcardRouter, so GET \\/journal can never be swallowed by GET \\/:id', /app\.use\('\/api\/boomcard', boomcardJournalRouter\);\s*\n\s*app\.use\('\/api\/boomcard', boomcardRouter\);/.test(serverTs));
ok('30. and it is wired into async error forwarding like every other router', /boomcardJournalRouter/.test(serverTs) && (serverTs.match(/boomcardJournalRouter/g) || []).length >= 2);
ok('30b. its authentication gate is scoped to \'/journal\' specifically, not router-wide -- boomcardRouter has its own deliberately PUBLIC cabinet route at the same base path, and an unscoped gate here would 401 it before boomcardRouter is ever reached', /router\.use\('\/journal', authenticateToken\);/.test(journal) && !/^router\.use\(authenticateToken\);/m.test(journal));

// ---------------------------------------------------------------- 8. RBAC: a dedicated, manager-only permission
ok('31. a dedicated boomcard.journal.view permission exists, separate from boomcard.view/boomcard.manage', /code: 'boomcard\.journal\.view'/.test(seed));
// Membership, parsed rather than positional: later stages (35.2-35.4) legitimately append more
// codes to the same grant list.
ok('32. it is granted to the manager roles', (() => {
  const m = /const stage17RolePerms = \[([^\]]*)\]/.exec(seed);
  return Boolean(m) && m[1].split(',').map(x => x.trim().replace(/^'|'$/g, '')).includes('boomcard.journal.view');
})());
ok('33. it is NOT granted to the cashier merely because the cashier can execute BOOMCARD operations', (() => {
  const loop = /for \(const code of \[([^\]]*)\]\) \{\s*\n\s*const p = allPerms\.find\(x => x\.code === code\) \|\| stage17Perms\.find\(x => x\.code === code\); if \(!p\) continue;\s*\n\s*await execute\(`INSERT INTO role_permissions \(id, role_id, permission_id, created_at\) VALUES \(\?, \?, \?, \?\) ON CONFLICT DO NOTHING`, \[`rp_csh_/.exec(seed);
  if (!loop) return false;
  const codes = loop[1].split(',').map(x => x.trim().replace(/^'|'$/g, ''));
  return codes.includes('boomcard.view') && !codes.includes('boomcard.journal.view');
})());
ok('34. every journal route requires that permission explicitly', (journal.match(/requirePermission\('boomcard\.journal\.view'\)/g) || []).length === 2);
ok('35. and boomcard.manage (execute) is a DIFFERENT permission from boomcard.journal.view (read the journal)', /requirePermission\('boomcard\.manage'\)/.test(boomcard) && !/boomcard\.journal\.view/.test(boomcard));

// ---------------------------------------------------------------- 9. frontend wiring
ok('36. the client asks the server for filtered, paginated rows and computes nothing itself', /getBoomcardJournal:/.test(api) && /getBoomcardJournalSummary:/.test(api) && !/reduce\(\(s|\.toFixed\(2\)\s*\*/.test(view));
ok('37. the screen is permission-gated in navigation', /permission: 'boomcard\.journal\.view'/.test(sidebar));
ok('38. and renders period, event-type, source and search filters plus pagination controls', /setStart/.test(view) && /setEventType/.test(view) && /setSource/.test(view) && /submitSearch/.test(view) && /setPage/.test(view));
ok('39. every row has a detail drawer with its drill-down identifiers', /setDetail\(r\)/.test(view) && /detail\.source_id/.test(view) && /detail\.order_id/.test(view));
ok('40. and the whole screen is bilingual', /"nav\.boomcardJournal": "Журнал BOOMCARD"/.test(read('src/translations/ru.ts')) && /"nav\.boomcardJournal": "BOOMCARD žurnaly"/.test(read('src/translations/tk.ts')));

console.log(`Stage 34.12 static checks: ${checks}`);
if (failures.length) { console.error(`\nFAILURES (${failures.length}):`); for (const f of failures) console.error(' - ' + f); process.exit(1); }
console.log('ALL STAGE 34.12 STATIC CHECKS PASSED');
