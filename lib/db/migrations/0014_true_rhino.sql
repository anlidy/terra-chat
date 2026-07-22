CREATE TABLE IF NOT EXISTS "KnowledgeCollection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"kind" varchar NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"collectionId" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "Project_collectionId_unique" UNIQUE("collectionId")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "CollectionResource" (
	"collectionId" uuid NOT NULL,
	"resourceId" uuid NOT NULL,
	"isEnabled" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "CollectionResource_collectionId_resourceId_pk" PRIMARY KEY("collectionId","resourceId")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "IngestionJob" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resourceId" uuid NOT NULL,
	"status" varchar DEFAULT 'queued' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"leaseExpiresAt" timestamp,
	"nextAttemptAt" timestamp,
	"errorMessage" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "Chat" ADD COLUMN "projectId" uuid;
--> statement-breakpoint
ALTER TABLE "Chat" ADD COLUMN "collectionId" uuid;
--> statement-breakpoint
ALTER TABLE "DocumentResource" ADD COLUMN "userId" uuid;
--> statement-breakpoint
ALTER TABLE "DocumentResource" ADD COLUMN "mimeType" text;
--> statement-breakpoint
ALTER TABLE "DocumentResource" ADD COLUMN "fileSize" integer;
--> statement-breakpoint
ALTER TABLE "DocumentResource" ADD COLUMN "contentHash" varchar(64);
--> statement-breakpoint
ALTER TABLE "DocumentResource" ADD COLUMN "pipelineVersion" varchar(100);
--> statement-breakpoint
ALTER TABLE "DocumentResource" ADD COLUMN "errorMessage" text;
--> statement-breakpoint
ALTER TABLE "DocumentResource" ADD COLUMN "updatedAt" timestamp DEFAULT now();
--> statement-breakpoint
UPDATE "Chat" SET "collectionId" = gen_random_uuid() WHERE "collectionId" IS NULL;
--> statement-breakpoint
INSERT INTO "KnowledgeCollection" ("id", "userId", "kind", "createdAt")
SELECT "collectionId", "userId", 'chat', "createdAt" FROM "Chat"
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
UPDATE "DocumentResource" AS resource
SET
	"userId" = chat."userId",
	"mimeType" = CASE resource."fileType"
		WHEN 'pdf' THEN 'application/pdf'
		WHEN 'docx' THEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
		WHEN 'xlsx' THEN 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
		WHEN 'pptx' THEN 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
		ELSE 'text/plain'
	END,
	"fileSize" = 0,
	"contentHash" = md5(resource."fileUrl") || md5(resource."fileUrl" || resource."id"::text),
	"pipelineVersion" = 'chat-rag-v1',
	"updatedAt" = resource."createdAt",
	"status" = CASE resource."status"
		WHEN 'pending' THEN 'queued'
		WHEN 'processing' THEN 'queued'
		WHEN 'error' THEN 'failed'
		ELSE resource."status"
	END
FROM "Chat" AS chat
WHERE resource."chatId" = chat."id";
--> statement-breakpoint
INSERT INTO "CollectionResource" ("collectionId", "resourceId", "createdAt")
SELECT chat."collectionId", resource."id", resource."createdAt"
FROM "DocumentResource" AS resource
INNER JOIN "Chat" AS chat ON resource."chatId" = chat."id"
ON CONFLICT ("collectionId", "resourceId") DO NOTHING;
--> statement-breakpoint
INSERT INTO "IngestionJob" ("resourceId", "status", "progress", "createdAt", "updatedAt")
SELECT
	"id",
	CASE "status" WHEN 'ready' THEN 'ready' WHEN 'failed' THEN 'failed' ELSE 'queued' END,
	CASE "status" WHEN 'ready' THEN 100 ELSE 0 END,
	"createdAt",
	"updatedAt"
FROM "DocumentResource";
--> statement-breakpoint
ALTER TABLE "DocumentResource" DROP CONSTRAINT "DocumentResource_chatId_Chat_id_fk";
--> statement-breakpoint
ALTER TABLE "Chat" ALTER COLUMN "collectionId" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "DocumentResource" ALTER COLUMN "userId" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "DocumentResource" ALTER COLUMN "mimeType" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "DocumentResource" ALTER COLUMN "fileSize" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "DocumentResource" ALTER COLUMN "contentHash" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "DocumentResource" ALTER COLUMN "pipelineVersion" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "DocumentResource" ALTER COLUMN "updatedAt" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "DocumentResource" ALTER COLUMN "status" SET DEFAULT 'draft';
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "KnowledgeCollection" ADD CONSTRAINT "KnowledgeCollection_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "Project" ADD CONSTRAINT "Project_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "Project" ADD CONSTRAINT "Project_collectionId_KnowledgeCollection_id_fk" FOREIGN KEY ("collectionId") REFERENCES "public"."KnowledgeCollection"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "CollectionResource" ADD CONSTRAINT "CollectionResource_collectionId_KnowledgeCollection_id_fk" FOREIGN KEY ("collectionId") REFERENCES "public"."KnowledgeCollection"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "CollectionResource" ADD CONSTRAINT "CollectionResource_resourceId_DocumentResource_id_fk" FOREIGN KEY ("resourceId") REFERENCES "public"."DocumentResource"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "IngestionJob" ADD CONSTRAINT "IngestionJob_resourceId_DocumentResource_id_fk" FOREIGN KEY ("resourceId") REFERENCES "public"."DocumentResource"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "Chat" ADD CONSTRAINT "Chat_projectId_Project_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "Chat" ADD CONSTRAINT "Chat_collectionId_KnowledgeCollection_id_fk" FOREIGN KEY ("collectionId") REFERENCES "public"."KnowledgeCollection"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "DocumentResource" ADD CONSTRAINT "DocumentResource_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collection_resource_resource_idx" ON "CollectionResource" USING btree ("resourceId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ingestion_job_resource_idx" ON "IngestionJob" USING btree ("resourceId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ingestion_job_status_attempt_idx" ON "IngestionJob" USING btree ("status","nextAttemptAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_user_updated_idx" ON "Project" USING btree ("userId","updatedAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_owner_hash_idx" ON "DocumentResource" USING btree ("userId","contentHash");
--> statement-breakpoint
ALTER TABLE "DocumentChunk" DROP COLUMN IF EXISTS "chatId";
--> statement-breakpoint
ALTER TABLE "DocumentResource" DROP COLUMN IF EXISTS "chatId";
--> statement-breakpoint
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_collectionId_unique" UNIQUE("collectionId");
