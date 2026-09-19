-- AlterTable
ALTER TABLE "boomcard_events" ADD COLUMN     "menu_item_id" TEXT,
ADD COLUMN     "order_id" TEXT;

-- AddForeignKey
ALTER TABLE "boomcard_events" ADD CONSTRAINT "boomcard_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boomcard_events" ADD CONSTRAINT "boomcard_events_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

