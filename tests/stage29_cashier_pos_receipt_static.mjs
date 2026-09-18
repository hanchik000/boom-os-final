// BOOM OS -- Stage 29: static regression guards for the Cashier POS + Receipt engine build.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const orders = fs.readFileSync(new URL('../server/routes/orders.ts', import.meta.url), 'utf8');
const print = fs.readFileSync(new URL('../server/routes/print.ts', import.meta.url), 'utf8');
const seed = fs.readFileSync(new URL('../server/seed.ts', import.meta.url), 'utf8');
const schema = fs.readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
const cashierView = fs.readFileSync(new URL('../src/components/CashierPOSView.tsx', import.meta.url), 'utf8');
const receiptSettings = fs.readFileSync(new URL('../src/components/ReceiptSettingsView.tsx', import.meta.url), 'utf8');
const apiTs = fs.readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8');

let passed = 0;
function check(label, cond) { assert.ok(cond, `FAILED: ${label}`); passed++; }

// --- backend routes exist, in the existing architectural style (no new Order/Payment core)
check("orders.ts has PATCH /:id/notes", /router\.patch\('\/:id\/notes'/.test(orders));
check("orders.ts has PATCH /:id/items/:itemId/note", /router\.patch\('\/:id\/items\/:itemId\/note'/.test(orders));
check("order notes endpoint is branch-scoped (allowed check)", /router\.patch\('\/:id\/notes'[\s\S]{0,600}allowed\(req,o\.branch_id\)/.test(orders));
check("order notes endpoint is audited", /router\.patch\('\/:id\/notes'[\s\S]{0,1400}ORDER_NOTES_UPDATED/.test(orders));
check("item note endpoint only touches ACTIVE items (soft-removed items excluded)", /order_items WHERE id=\?\s*AND order_id=\?\s*AND status=\\?'ACTIVE\\?'/.test(orders));
check("print.ts has PUT /profiles/:id (update, not just create)", /router\.put\('\/profiles\/:id'/.test(print));
check("print profile update requires print.manage", /router\.put\('\/profiles\/:id',requirePermission\('print\.manage'\)/.test(print));

// --- no new Order Core / Payment Core / CashShift Core / permission system was introduced
check("no new prisma.* ORM write calls introduced (still the raw-SQL wrapper convention)", !/prisma\.(order|payment|cashShift)\./.test(orders + print));
check("no INSERT INTO orders/payments outside the pre-existing statements", (orders.match(/INSERT INTO orders /g) || []).length === 1);

// --- schema: additive, nullable, non-destructive
check("Order.internal_notes is nullable (String?)", /internal_notes\s+String\?/.test(schema));
const orderModelMatch = schema.match(/model Order \{[\s\S]*?\n\}/);
check("internal_notes lives on the existing Order model, no new order table", orderModelMatch && /internal_notes/.test(orderModelMatch[0]));

// --- seed.ts: CASHIER gets print.view/execute/reprint, NOT print.manage; refund untouched
const cashierBlockMatch = seed.match(/if \(roleCashier\) \{[\s\S]*?\n  \}/);
check("cashier grant block found", !!cashierBlockMatch);
const cashierBlock = cashierBlockMatch[0];
check("CASHIER granted print.view", /'print\.view'/.test(cashierBlock));
check("CASHIER granted print.execute", /'print\.execute'/.test(cashierBlock));
check("CASHIER granted print.reprint", /'print\.reprint'/.test(cashierBlock));
check("CASHIER NOT granted print.manage", !/'print\.manage'/.test(cashierBlock));
check("CASHIER still NOT granted payments.refund anywhere in its block", !/'payments\.refund'/.test(cashierBlock));

// --- frontend: no refund action for CASHIER, real backend methods only, server-authoritative totals
check("CashierPOSView never calls refundPayment", !/refundPayment/.test(cashierView));
check("CashierPOSView sends the real POS session token on payment", /createPayment\(\{[\s\S]{0,300}posToken/.test(cashierView));
check("CashierPOSView payment methods come from the real backend set", /PAYMENT_METHODS = \['CASH', 'CARD', 'ONLINE', 'BONUS', 'OTHER'\]/.test(cashierView));
check("CashierPOSView does not locally compute totals (uses detail.final_amount / subtotal / service_charge from the server)", /detail\.final_amount/.test(cashierView) && !/subtotal\s*\*|final_amount\s*=\s*subtotal/.test(cashierView));
check("Print action creates a real print job (audit-tracked), not a fake client-only print", /createPrintJob/.test(cashierView));
check("Reprint action uses the real reprint endpoint", /reprintJob/.test(cashierView));
check("Reprint never calls createPayment or any inventory/order-mutating call", (() => {
  const idx = cashierView.indexOf('const reprintReceipt');
  const fn = cashierView.slice(idx, cashierView.indexOf('};', idx));
  return !/createPayment|createWaiterOrder|updateKdsStatus/.test(fn);
})());

// --- receipt settings: manager-only, branch-aware, internal notes excluded by construction
check("ReceiptSettingsView gates editing on print.manage", /hasPermission\('print\.manage'\)/.test(receiptSettings));
check("ReceiptSettingsView never reads internal_notes (never offered as a receipt field)", !/internal_notes|internal_note/.test(receiptSettings));
check("Receipt preview in CashierPOSView never renders internal_notes", !/receiptOrder\.internal_notes/.test(cashierView));

// --- api.ts: new client methods exist and reuse existing endpoints, no parallel API surface
check("api.ts exposes unlockOperatorPos", /unlockOperatorPos:/.test(apiTs));
check("api.ts exposes lockOperatorPos", /lockOperatorPos:/.test(apiTs));
check("api.ts exposes updateOrderNotes", /updateOrderNotes:/.test(apiTs));
check("api.ts exposes updateOrderItemNote", /updateOrderItemNote:/.test(apiTs));
check("api.ts createPayment supports an optional POS session token header", /createPayment:[\s\S]{0,260}X-Pos-Session-Token/.test(apiTs));

console.log(`STAGE 29 CASHIER POS + RECEIPT STATIC: PASS (${passed}/${passed} checks)`);
