CREATE TABLE "pos_media" (
  "id" TEXT NOT NULL,
  "branch_id" TEXT,
  "name" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "mime_type" TEXT,
  "size_bytes" BIGINT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "schedule_start" TEXT,
  "schedule_end" TEXT,
  "is_fallback" BOOLEAN NOT NULL DEFAULT false,
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  CONSTRAINT "pos_media_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "idx_pos_media_branch_active" ON "pos_media"("branch_id","active");
CREATE INDEX "idx_pos_media_priority_order" ON "pos_media"("priority","sort_order");
ALTER TABLE "pos_media" ADD CONSTRAINT "pos_media_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pos_media" ADD CONSTRAINT "pos_media_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pos_media" ADD CONSTRAINT "pos_media_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
