-- Converge renamed columns to the Prisma schema (data-preserving).
--
-- The schema declares snake_case physical names via @map for six columns,
-- but no migration ever renamed them, so databases created by the
--checked-in migrations still carry the original camelCase columns while
-- Prisma reads/writes the snake_case names (P2022 at runtime).
--
-- Each step is conditional on information_schema so the migration converges
-- from any prior state (camelCase / snake_case / neither) without failing:
--   1. RENAME when the old camelCase column exists.
--   2. ADD COLUMN IF NOT EXISTS when the snake_case column is still missing.

DO $$
BEGIN
  -- OutreachOrder AI enrichment columns
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'OutreachOrder' AND column_name = 'aiEnabled') THEN
    ALTER TABLE "OutreachOrder" RENAME COLUMN "aiEnabled" TO "ai_enabled";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'OutreachOrder' AND column_name = 'aiModel') THEN
    ALTER TABLE "OutreachOrder" RENAME COLUMN "aiModel" TO "ai_model";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'OutreachOrder' AND column_name = 'enrichmentStatus') THEN
    ALTER TABLE "OutreachOrder" RENAME COLUMN "enrichmentStatus" TO "enrichment_status";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'OutreachOrder' AND column_name = 'personalizationContext') THEN
    ALTER TABLE "OutreachOrder" RENAME COLUMN "personalizationContext" TO "personalization_context";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'OutreachOrder' AND column_name = 'selectedService') THEN
    ALTER TABLE "OutreachOrder" RENAME COLUMN "selectedService" TO "selected_service";
  END IF;
  -- FollowUp sequence column
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'FollowUp' AND column_name = 'followUpNumber') THEN
    ALTER TABLE "FollowUp" RENAME COLUMN "followUpNumber" TO "follow_up_number";
  END IF;
END
$$;

ALTER TABLE "OutreachOrder" ADD COLUMN IF NOT EXISTS "ai_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "OutreachOrder" ADD COLUMN IF NOT EXISTS "ai_model" TEXT;
ALTER TABLE "OutreachOrder" ADD COLUMN IF NOT EXISTS "enrichment_status" TEXT;
ALTER TABLE "OutreachOrder" ADD COLUMN IF NOT EXISTS "personalization_context" JSONB;
ALTER TABLE "OutreachOrder" ADD COLUMN IF NOT EXISTS "selected_service" TEXT;
ALTER TABLE "FollowUp" ADD COLUMN IF NOT EXISTS "follow_up_number" INTEGER NOT NULL DEFAULT 1;
