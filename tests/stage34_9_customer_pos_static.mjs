// BOOM OS -- Stage 34.9 static source guards: customer / CRM flow.
// Guards against a second customer identity, against a phone being forced on a walk-in guest,
// against duplicate guests, and against identification ever changing a price.
import fs from 'node:fs';

const failures = []; let checks = 0;
const read = p => fs.readFileSync(p, 'utf8');
function ok(label, cond, detail) { checks++; if (!cond) failures.push(`${label}${detail ? ' -> ' + String(detail).slice(0, 220) : ''}`); }

const customers = read('server/routes/customers.ts');
const credit = read('server/routes/credit.ts');
const orders = read('server/routes/orders.ts');
const schema = read('prisma/schema.prisma');
const api = read('src/api.ts');
const waiter = read('src/components/WaiterPOSView.tsx');
const cashier = read('src/components/CashierPOSView.tsx');
const view = read('src/components/CustomersView.tsx');
const sidebar = read('src/components/Sidebar.tsx');
const migration = read('prisma/migrations/20260920020000_stage34_9_customer_pos/migration.sql');

// ---------------------------------------------------------------- 1. one customer core
ok('1. there is one customers table', (schema.match(/^model Customer \{/m) || []).length === 1);
ok('2. and one create-or-return routine every surface uses', (customers.match(/export async function findOrCreateCustomer/g) || []).length === 1 && /findOrCreateCustomer/.test(credit) && !/INSERT INTO customers/.test(credit));
ok('3. one identity payload serves the POS and CRM alike', (customers.match(/async function customerIdentity/g) || []).length === 1 && (customers.match(/customerIdentity\(c\)/g) || []).length === 2);
ok('4. it reads each balance from its own authoritative ledger, never a cached column', /FROM boomcoin_ledger WHERE customer_id=\?/.test(customers) && /FROM boomback_ledger WHERE customer_id=\?/.test(customers));
ok('5. and carries BOOMCARD and credit alongside', /FROM boomcards WHERE customer_id=\?/.test(customers) && /FROM credit_accounts WHERE customer_id=\?/.test(customers));

// ---------------------------------------------------------------- 2. name required, phone optional
ok('6. the phone column is nullable', /phone      String\?/.test(schema) && /ALTER COLUMN "phone" DROP NOT NULL/.test(migration));
ok('7. a name is still required from both surfaces', (customers.match(/CUSTOMER_NAME_REQUIRED/g) || []).length === 2);
ok('8. and a phone is never demanded', !/CUSTOMER_PHONE_REQUIRED/.test(customers) && !/name \|\| !phone/.test(customers));
ok('9. a blank phone is stored as NULL, so two walk-ins never collide', /const phone = opts\.phone && opts\.phone\.trim\(\) \? opts\.phone\.trim\(\) : null;/.test(customers));
ok('10. a guest is only matched when there IS a phone to match on', /if \(phone\) \{[\s\S]{0,260}if \(existing\) return \{ customer: existing, existed: true \};/.test(customers));
ok('11. the uniqueness that prevents duplicates is still per branch + phone', /@@unique\(\[branch_id, phone\], map: "customers_branch_phone_key"\)/.test(schema));

// ---------------------------------------------------------------- 3. identification never changes a price
ok('12. a customer profile carries no scalar discount field', (() => {
  const model = /model Customer \{[\s\S]*?\n\}/.exec(schema)[0];
  return !model.split('\n').some(l => /^\s*\w*discount\w*\s+(Decimal|Int|Float|String|Boolean)/i.test(l));
})());
ok('13. attaching a guest touches no money column', (() => {
  const i = orders.indexOf("router.post('/:id/customer'");
  const body = i < 0 ? '' : orders.slice(i, orders.indexOf("router.get('/discount-options'"));
  return i >= 0 && !/recomputeOrderTotals|final_amount|discount=CAST/.test(body);
})());
ok('14. the CRM screen says so in plain words', /Привязка клиента не даёт скидку/.test(view) || /не даёт скидку/.test(view));
ok('15. and so does the waiter POS', /Привязка клиента не меняет цену заказа/.test(waiter));

// ---------------------------------------------------------------- 4. every surface, same record
ok('16. the waiter POS can search, create and attach', /searchWaiterCustomers/.test(api) && /createWaiterCustomer/.test(api) && /setWaiterOrderCustomer/.test(api) && /attachGuest/.test(waiter) && /createGuest/.test(waiter));
ok('17. and read the same identity the cashier and CRM read', /getWaiterCustomerIdentity/.test(api) && /router\.get\('\/pos\/:id'/.test(customers));
ok('18. the cashier POS uses the same central client methods', /getCustomers/.test(cashier) && /createCustomer/.test(cashier) && /setOrderCustomer/.test(cashier));
ok('19. the waiter POS shows the loyalty identity without computing any of it', /guestIdentity\.boomcoin\.balance/.test(waiter) && !/BOOMCOIN_SPEND_PER_COIN|floor\(/.test(waiter));
ok('20. the CRM screen is permission-gated and wired into navigation', /hasPermission\('customers\.view'\)/.test(view) && /permission: 'customers\.view'/.test(sidebar));

// ---------------------------------------------------------------- 5. RBAC, isolation, audit
ok('21. every authenticated customer route is branch-checked with the existing helper', (customers.match(/allowed\(req, ?(b|c\.branch_id)\)/g) || []).length >= 4);
ok('22. the POS routes are scoped to the session\'s own branch', /c\.branch_id !== pos\.branchId/.test(customers));
ok('23. a customer from another branch can never be attached to an order', /CUSTOMER_BRANCH_MISMATCH/.test(orders));
ok('24. creating and updating a guest are audited', /action: opts\.action/.test(customers) && /CUSTOMER_UPDATED/.test(customers));
ok('25. the migration is a single nullability relaxation -- nothing dropped', /ALTER COLUMN "phone" DROP NOT NULL/.test(migration) && !/DROP TABLE|DROP COLUMN/.test(migration));

console.log(`Stage 34.9 static checks: ${checks}`);
if (failures.length) { console.error(`\nFAILURES (${failures.length}):`); for (const f of failures) console.error(' - ' + f); process.exit(1); }
console.log('ALL STAGE 34.9 STATIC CHECKS PASSED');
