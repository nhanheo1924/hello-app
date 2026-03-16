CREATE SCHEMA IF NOT EXISTS "task";
SET search_path TO "task";

CREATE TYPE "workspace_role" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');
CREATE TYPE "project_status" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "task_priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
CREATE TYPE "task_status" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE', 'BLOCKED');

CREATE TABLE "workspaces" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "owner_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workspace_members" (
  "workspace_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "role" "workspace_role" NOT NULL DEFAULT 'MEMBER',
  "joined_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("workspace_id", "user_id")
);

CREATE TABLE "projects" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NULL,
  "status" "project_status" NOT NULL DEFAULT 'ACTIVE',
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "project_members" (
  "project_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "role" "workspace_role" NOT NULL DEFAULT 'MEMBER',
  "joined_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_members_pkey" PRIMARY KEY ("project_id", "user_id")
);

CREATE TABLE "columns" (
  "id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "columns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tasks" (
  "id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "column_id" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NULL,
  "priority" "task_priority" NOT NULL DEFAULT 'MEDIUM',
  "status" "task_status" NOT NULL DEFAULT 'TODO',
  "due_at" TIMESTAMPTZ NULL,
  "assignee_id" UUID NULL,
  "order_index" INTEGER NOT NULL DEFAULT 0,
  "created_by" UUID NOT NULL,
  "archived_at" TIMESTAMPTZ NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "comments" (
  "id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "author_id" UUID NOT NULL,
  "content" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "labels" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "color" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "labels_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "task_labels" (
  "task_id" UUID NOT NULL,
  "label_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_labels_pkey" PRIMARY KEY ("task_id", "label_id")
);

CREATE TABLE "activities" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NULL,
  "task_id" UUID NULL,
  "actor_id" UUID NOT NULL,
  "action" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "payload" JSONB NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "idempotency_records" (
  "id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "user_id" UUID NOT NULL,
  "action" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "response" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "labels_workspace_id_name_key" ON "labels"("workspace_id", "name");
CREATE UNIQUE INDEX "idempotency_records_key_user_id_action_key" ON "idempotency_records"("key", "user_id", "action");

CREATE INDEX "workspaces_owner_id_idx" ON "workspaces"("owner_id");
CREATE INDEX "workspace_members_user_id_idx" ON "workspace_members"("user_id");
CREATE INDEX "workspace_members_workspace_id_role_idx" ON "workspace_members"("workspace_id", "role");
CREATE INDEX "projects_workspace_id_idx" ON "projects"("workspace_id");
CREATE INDEX "projects_status_idx" ON "projects"("status");
CREATE INDEX "project_members_user_id_idx" ON "project_members"("user_id");
CREATE INDEX "project_members_project_id_role_idx" ON "project_members"("project_id", "role");
CREATE INDEX "columns_project_id_position_idx" ON "columns"("project_id", "position");
CREATE INDEX "tasks_project_id_column_id_order_index_idx" ON "tasks"("project_id", "column_id", "order_index");
CREATE INDEX "tasks_assignee_id_idx" ON "tasks"("assignee_id");
CREATE INDEX "tasks_status_idx" ON "tasks"("status");
CREATE INDEX "tasks_due_at_idx" ON "tasks"("due_at");
CREATE INDEX "comments_task_id_created_at_idx" ON "comments"("task_id", "created_at");
CREATE INDEX "comments_author_id_idx" ON "comments"("author_id");
CREATE INDEX "labels_workspace_id_idx" ON "labels"("workspace_id");
CREATE INDEX "task_labels_label_id_idx" ON "task_labels"("label_id");
CREATE INDEX "activities_workspace_id_created_at_idx" ON "activities"("workspace_id", "created_at");
CREATE INDEX "activities_project_id_created_at_idx" ON "activities"("project_id", "created_at");
CREATE INDEX "activities_task_id_created_at_idx" ON "activities"("task_id", "created_at");
CREATE INDEX "idempotency_records_created_at_idx" ON "idempotency_records"("created_at");

ALTER TABLE "workspace_members"
ADD CONSTRAINT "workspace_members_workspace_id_fkey"
FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "projects"
ADD CONSTRAINT "projects_workspace_id_fkey"
FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_members"
ADD CONSTRAINT "project_members_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "projects"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "columns"
ADD CONSTRAINT "columns_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "projects"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tasks"
ADD CONSTRAINT "tasks_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "projects"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tasks"
ADD CONSTRAINT "tasks_column_id_fkey"
FOREIGN KEY ("column_id") REFERENCES "columns"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "comments"
ADD CONSTRAINT "comments_task_id_fkey"
FOREIGN KEY ("task_id") REFERENCES "tasks"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "labels"
ADD CONSTRAINT "labels_workspace_id_fkey"
FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "task_labels"
ADD CONSTRAINT "task_labels_task_id_fkey"
FOREIGN KEY ("task_id") REFERENCES "tasks"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "task_labels"
ADD CONSTRAINT "task_labels_label_id_fkey"
FOREIGN KEY ("label_id") REFERENCES "labels"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "activities"
ADD CONSTRAINT "activities_workspace_id_fkey"
FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "activities"
ADD CONSTRAINT "activities_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "projects"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "activities"
ADD CONSTRAINT "activities_task_id_fkey"
FOREIGN KEY ("task_id") REFERENCES "tasks"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
