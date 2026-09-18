// BOOM OS -- Stage 34.1 static source guards: production-aware cancellation / refund semantics.
// Asserts the source itself cannot regress to "a refund restores the ingredients", cannot guess
// the product decision, cannot let a waiter finalise a closure, cannot physically delete an order,
// and did not fork a second Order/Payment/Inventory core.
import fs from 'node:fs';

const failures = [];
let checks = 0;
const read = (p) => fs.readFileSync(p, 'utf8');
function ok(label, cond, detail) { checks++; if (!cond) failures.push(`${label}${detail ? ' -> ' + String(detail).slice(0, 220) : ''}`); }

const closure = read('server/order-closure.ts');
const payments = read('server/routes/payments.ts');
const orders = read('server/routes/orders.ts');
const seed = read('server/seed.ts');
const schema = read('prisma/schema.prisma');
const api = read('src/api.ts');
const approvals = read('src/components/OrderApprovalsView.tsx');
const waiterPos = read('src/components/WaiterPOSView.tsx');
const cashierPos = read('src/components/CashierPOSView.tsx');
const migration = read('prisma/migrations/20260918210000_stage34_1_order_closures/migration.sql');

// ---------------------------------------------------------------- 1. the core rule
ok('1. the unconditional restore-on-refund helper is gone from payments.ts', !/async function restoreInventoryForOrder\s*\(/.test(payments), payments.match(/restoreInventoryForOrder[^\n]*/)?.[0]);
ok('2. the refund route no longer calls any inventory restore', !/refund[\s\S]{0,2600}restoreInventoryForOrder/.test(payments));
ok('3. RESTORE_STOCK is refused once production has started', /INVENTORY_RESTORE_FORBIDDEN_AFTER_PRODUCTION/.test(closure) && /inventory_treatment === 'RESTORE_STOCK' && prod\.started/.test(closure));
ok('4. the same rule is enforced at request time, not only at approval', /RESTORE_STOCK' && prod\.started/.test(orders));
ok('5. a write-off of already-consumed stock never moves stock a second time', /if \(sales\.length > 0\)[\s\S]{0,320}return fromScaled4\(lossScaled4\);/.test(closure));
ok('6. an unpaid but produced order is written off as WASTE / PRODUCTION_LOSS', /'WASTE'[\s\S]{0,200}'ORDER_CLOSURE'[\s\S]{0,80}'PRODUCTION_LOSS'/.test(closure));

// ---------------------------------------------------------------- 2. no guessing, no self-service
ok('7. the inventory treatment must be explicitly supplied', /INVENTORY_TREATMENT_REQUIRED/.test(orders) && /INVENTORY_TREATMENTS as readonly string\[\]\)\.includes\(treatment\)/.test(orders));
ok('8. a closure is never auto-approved: it is inserted as PENDING', /INSERT INTO order_closures[\s\S]{0,400}'PENDING'/.test(orders));
ok('9. a waiter may not request an establishment closure', /CLOSURE_TYPE_NOT_ALLOWED_FOR_WAITER/.test(orders));
ok('10. a waiter may not request a refund', /WAITER_CANNOT_REQUEST_REFUND/.test(orders));
ok('11. the requester can never approve their own closure', /requester_user_id === req\.user!\.id[\s\S]{0,120}SELF_APPROVAL_FORBIDDEN/.test(orders));
ok('12. approving a refund additionally requires payments.refund', /REFUND_PERMISSION_REQUIRED/.test(orders) && /permissions\.includes\('payments\.refund'\)/.test(orders));

// ---------------------------------------------------------------- 3. no arbitrary historical refund
ok('13. the refund endpoint actually throws when no APPROVED closure authorises it (not merely a mapped error code)', /if\(!closure\)throw Object\.assign\(new Error\('REFUND_REQUIRES_APPROVED_CLOSURE'\)/.test(payments));
ok('14. that closure must actually authorise a refund and be unspent', /status='APPROVED' AND refund_requested=true AND refund_payment_id IS NULL/.test(payments));
ok('15. a refund cannot be requested for an unpaid order', /REFUND_REQUIRES_PAID_ORDER/.test(orders));

// ---------------------------------------------------------------- 4. one core, no forks
ok('16. there is exactly one closure application routine', (closure.match(/export async function applyApprovedClosure/g) || []).length === 1);
ok('17. both the approval route and the refund route use the shared closure core', /from '\.\.\/order-closure'/.test(orders) && /from '\.\.\/order-closure'/.test(payments));
ok('18. no second consumption routine was introduced', !/function consumeInventoryForOrder/.test(closure));
ok('19. production state is read from the existing KDS ticket, not a new state machine', /FROM kds_tickets WHERE order_id=\?/.test(closure) && !/production_status/.test(schema));
ok('20. no Prisma Client write escape hatch in the new module', !/prisma\.[a-z]/i.test(closure));

// ---------------------------------------------------------------- 5. money / quantity precision
ok('21. no Float arithmetic in the closure cost maths -- BigInt ten-thousandths only', /function scaled4/.test(closure) && /fromScaled4/.test(closure) && !/parseFloat|Number\([^)]*cost/.test(closure));
ok('22. the ledger unit_cost was widened so a 4-decimal ingredient cost is not silently rounded', /unit_cost\s+Decimal\? @db\.Decimal\(14,4\)/.test(schema) && /stock_movements" ALTER COLUMN "unit_cost" SET DATA TYPE DECIMAL\(14,4\)/.test(migration));
ok('23. write_off_cost is stored through a numeric cast, never as a JS number', /write_off_cost=CAST\(\? AS numeric\)/.test(closure));

// ---------------------------------------------------------------- 6. soft close, never delete
ok('24. no order, payment or movement is ever physically deleted by the closure flow', !/DELETE FROM (orders|payments|stock_movements|order_items)/.test(closure + orders + payments));
ok('25. the new terminal status is applied to the order, not a row removal', /CLOSED_BY_ESTABLISHMENT' : \(refundedAny \? 'REFUNDED' : 'CANCELLED'\)/.test(closure));
ok('26. the new terminal status is treated as closed everywhere a table is released', (payments.match(/'COMPLETED','REFUNDED','CANCELLED','CLOSED_BY_ESTABLISHMENT'/g) || []).length === 1 && (orders.match(/'COMPLETED','REFUNDED','CANCELLED','CLOSED_BY_ESTABLISHMENT'/g) || []).length === 1 && (closure.match(/'COMPLETED','REFUNDED','CANCELLED','CLOSED_BY_ESTABLISHMENT'/g) || []).length === 1);

// ---------------------------------------------------------------- 7. RBAC / branch isolation / audit
ok('27. both new permissions exist and are seeded', /orders\.closure\.request/.test(seed) && /orders\.closure\.approve/.test(seed));
const rolePerms = seed.match(/const stage17RolePerms = \[([^\]]*)\]/);
ok('28. the approval permission is granted through the existing manager role list', rolePerms && rolePerms[1].includes("'orders.closure.approve'"), rolePerms?.[1]);
ok('29. the cashier can request but not approve', /'credit\.repay','orders\.closure\.request'\]/.test(seed) && !/roleCashier[\s\S]{0,900}orders\.closure\.approve/.test(seed));
ok('30. every closure route enforces branch authorization with the existing helper', (orders.match(/closure/gi) || []).length > 0 && /allowed\(req, c\.branch_id\)/.test(orders) && /!branchId \|\| !allowed\(req, branchId\)/.test(orders));
ok('31. a waiter-raised closure is scoped to that waiter\'s own order and branch', /order\.branch_id !== session\.branch_id \|\| order\.waiter_user_id !== session\.user_id/.test(orders));
ok('32. request, approval and rejection are all audited', /ORDER_CLOSURE_REQUESTED/.test(orders) && /ORDER_CLOSURE_REJECTED/.test(orders) && /ORDER_CLOSURE_APPROVED/.test(closure));
ok('33. the approval audit records the production state it was judged against', /production_state_at_decision: prod\.state/.test(closure));

// ---------------------------------------------------------------- 8. auto-cancel thresholds
ok('34. both timeouts are configurable system settings, not literals in route code', /ORDER_CONFIRMATION_TIMEOUT/.test(seed) && /KITCHEN_ACCEPT_TIMEOUT/.test(seed) && /FROM system_settings WHERE key IN \('ORDER_CONFIRMATION_TIMEOUT','KITCHEN_ACCEPT_TIMEOUT'\)/.test(orders));
ok('35. auto-cancel never touches an order whose production has started', /if \(prod\.started\) return;/.test(orders) && /production started -- never automatic/.test(orders));
ok('36. auto-cancel is an explicit authorised action, not a hidden background mutation', /router\.post\('\/closures\/auto-cancel', authenticateToken, requirePermission\('orders\.closure\.approve'\)/.test(orders));

// ---------------------------------------------------------------- 9. schema + migration
ok('37. the closure table is additive and carries the full decision record', /model OrderClosure/.test(schema) && ['inventory_treatment','refund_requested','production_state','requester_user_id','approver_user_id','write_off_cost','paid_at_request'].every(f => new RegExp(f).test(schema)));
ok('38. the migration only creates the new table and widens one column', /CREATE TABLE "order_closures"/.test(migration) && !/DROP TABLE/.test(migration));

// ---------------------------------------------------------------- 10. frontend
ok('39. the API client exposes the closure flow through the one central client', /requestWaiterOrderClosure/.test(api) && /requestOrderClosure/.test(api) && /approveOrderClosure/.test(api) && /rejectOrderClosure/.test(api));
ok('40. the waiter POS OTKAZ never pre-selects the product decision and cannot submit without one', /setRefusalTreatment\(''\)/.test(waiterPos) && /!refusalTreatment\}/.test(waiterPos));
ok('41. the cashier POS establishment closure does the same', /setClosureTreatment\(''\)/.test(cashierPos) && /!closureTreatment\}/.test(cashierPos));
ok('42. neither POS screen computes or sends an authoritative money amount for the closure', !/write_off_cost/.test(waiterPos) && !/write_off_cost/.test(cashierPos));
ok('43. the manager approval screen shows the requested treatment and the production state verbatim', /treatmentLabel/.test(approvals) && /productionLabel/.test(approvals) && /orders\.closure\.approve/.test(approvals));
ok('44. both POS screens and the approval screen carry RU + TK copy', /Önümleri hasapdan aýyrmak/.test(approvals) && /KÄRHANA TARAPYNDAN ÝAPYLDY/.test(cashierPos) && /Списать продукты/.test(waiterPos));

console.log(`Stage 34.1 static checks: ${checks}`);
if (failures.length) { console.error(`\nFAILURES (${failures.length}):`); for (const f of failures) console.error(' - ' + f); process.exit(1); }
console.log('ALL STAGE 34.1 STATIC CHECKS PASSED');
