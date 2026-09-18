CREATE TABLE "branch_order_sequences" (
  "branch_id" TEXT NOT NULL,
  "next_value" INTEGER NOT NULL DEFAULT 1,
  "updated_at" TEXT NOT NULL,
  CONSTRAINT "branch_order_sequences_pkey" PRIMARY KEY ("branch_id")
);
ALTER TABLE "branch_order_sequences" ADD CONSTRAINT "branch_order_sequences_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
