-- Stage 39 — Customer Menu site design.
-- Additive only: nullable columns on the existing visual_catalog_blocks table plus one new
-- per-branch design table. Nothing is dropped, renamed or retyped; no existing row is rewritten,
-- so every block created before this stage keeps rendering exactly as it did.

-- 1. EN text and a CTA label. The CTA's destination stays in the existing link_* columns.
ALTER TABLE "visual_catalog_blocks" ADD COLUMN "title_en" TEXT;
ALTER TABLE "visual_catalog_blocks" ADD COLUMN "subtitle_en" TEXT;
ALTER TABLE "visual_catalog_blocks" ADD COLUMN "cta_label_ru" TEXT;
ALTER TABLE "visual_catalog_blocks" ADD COLUMN "cta_label_tk" TEXT;
ALTER TABLE "visual_catalog_blocks" ADD COLUMN "cta_label_en" TEXT;

-- 2. Per-section appearance presets. Enum-valued, validated server-side; never free CSS.
ALTER TABLE "visual_catalog_blocks" ADD COLUMN "card_style" TEXT;
ALTER TABLE "visual_catalog_blocks" ADD COLUMN "density" TEXT;
ALTER TABLE "visual_catalog_blocks" ADD COLUMN "image_ratio" TEXT;
ALTER TABLE "visual_catalog_blocks" ADD COLUMN "overlay" TEXT;
ALTER TABLE "visual_catalog_blocks" ADD COLUMN "alignment" TEXT;

-- 3. The page-level design of a branch's Customer Menu: preset identifiers only.
CREATE TABLE "site_designs" (
  "id"          TEXT NOT NULL,
  "branch_id"   TEXT NOT NULL,
  "theme"       TEXT NOT NULL DEFAULT 'MIDNIGHT',
  "accent"      TEXT NOT NULL DEFAULT 'GOLD',
  "typography"  TEXT NOT NULL DEFAULT 'EDITORIAL',
  "card_style"  TEXT NOT NULL DEFAULT 'STANDARD',
  "density"     TEXT NOT NULL DEFAULT 'NORMAL',
  "radius"      TEXT NOT NULL DEFAULT 'ROUNDED',
  "image_ratio" TEXT NOT NULL DEFAULT 'LANDSCAPE',
  "show_hero"   BOOLEAN NOT NULL DEFAULT true,
  "updated_by"  TEXT,
  "created_at"  TEXT NOT NULL,
  "updated_at"  TEXT NOT NULL,
  CONSTRAINT "site_designs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "site_designs_branch_id_key" ON "site_designs"("branch_id");
ALTER TABLE "site_designs"
  ADD CONSTRAINT "site_designs_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "site_designs"
  ADD CONSTRAINT "site_designs_updated_by_fkey"
  FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
