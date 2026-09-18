# BOOM OS Stage 15 — Order Item Removal Approval

## Scope
Stage 15 adds the mandatory manager approval workflow for removing items from waiter-created orders. It extends the existing Order Core; it does not create a second order architecture.

## Business rule
After an order is sent, a waiter cannot directly delete an item. The waiter creates a removal request with a quantity and mandatory reason. A manager with `orders.item_remove.approve` approves or rejects it.

Approved removal is represented as an immutable operational history on the original `OrderItem` (`status=REMOVED` for full removal, or a reduced quantity for partial removal). No `DELETE FROM order_items` operation is used.

## API
- `POST /api/orders/:id/items/:itemId/removal-request` — waiter POS session creates a request.
- `GET /api/orders/removal-requests` — manager lists requests in an authorized branch.
- `POST /api/orders/removal-requests/:approvalId/approve` — manager approves.
- `POST /api/orders/removal-requests/:approvalId/reject` — manager rejects.

## Audit
Requests and decisions use `MANAGER_APPROVAL` with requester, approver, order/item, quantity, reason, status and timestamps.

## State and concurrency
Order, item and approval rows are locked with `FOR UPDATE` during decisions. A second pending request for the same item is rejected. Self-approval is forbidden. Completed/cancelled/refunded orders cannot be changed.

## KDS and money
KDS only exposes active order items. After approval the order subtotal and DINE_IN service charge are recalculated server-side with cent rounding. The existing price snapshots remain immutable.

## Migration
`20260908001100_order_item_removal_approvals` adds item removal metadata and the approval table/indexes.
