SET search_path TO "task";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workspace_status') THEN
    CREATE TYPE workspace_status AS ENUM ('ACTIVE', 'ARCHIVED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'membership_status') THEN
    CREATE TYPE membership_status AS ENUM ('ACTIVE', 'INVITED', 'REMOVED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_visibility') THEN
    CREATE TYPE project_visibility AS ENUM ('PRIVATE', 'WORKSPACE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_view_type') THEN
    CREATE TYPE project_view_type AS ENUM ('BOARD', 'CALENDAR');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invitation_status') THEN
    CREATE TYPE invitation_status AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type') THEN
    CREATE TYPE notification_type AS ENUM (
      'TASK_ASSIGNED',
      'TASK_DUE_SOON',
      'TASK_OVERDUE',
      'COMMENT_ADDED',
      'PROJECT_INVITATION',
      'ROLE_CHANGED',
      'PROJECT_ARCHIVED'
    );
  END IF;
END $$;

ALTER TABLE workspaces RENAME COLUMN owner_id TO owner_user_id;
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS status workspace_status NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE workspace_members
  ADD COLUMN IF NOT EXISTS status membership_status NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS invited_by_user_id UUID;

ALTER TABLE projects RENAME COLUMN created_by TO created_by_user_id;
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS owner_user_id UUID,
  ADD COLUMN IF NOT EXISTS visibility project_visibility NOT NULL DEFAULT 'PRIVATE',
  ADD COLUMN IF NOT EXISTS default_view project_view_type NOT NULL DEFAULT 'BOARD',
  ADD COLUMN IF NOT EXISTS color TEXT,
  ADD COLUMN IF NOT EXISTS icon TEXT,
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS end_date DATE,
  ADD COLUMN IF NOT EXISTS updated_by_user_id UUID,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

UPDATE projects
SET owner_user_id = created_by_user_id
WHERE owner_user_id IS NULL;

UPDATE projects
SET updated_by_user_id = created_by_user_id
WHERE updated_by_user_id IS NULL;

ALTER TABLE projects
  ALTER COLUMN owner_user_id SET NOT NULL;

ALTER TABLE project_members
  ADD COLUMN IF NOT EXISTS status membership_status NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS invited_by_user_id UUID;

ALTER TABLE tasks RENAME COLUMN assignee_id TO assignee_user_id;
ALTER TABLE tasks RENAME COLUMN created_by TO created_by_user_id;
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS start_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS all_day BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS estimated_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_by_user_id UUID;

UPDATE tasks
SET completed_at = COALESCE(completed_at, updated_at)
WHERE status = 'DONE'::task_status;

ALTER TABLE tasks
  ALTER COLUMN column_id DROP NOT NULL;

ALTER TABLE comments RENAME COLUMN author_id TO author_user_id;
ALTER TABLE activities RENAME COLUMN actor_id TO actor_user_id;

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_column_id_fkey;
ALTER TABLE tasks
  ADD CONSTRAINT tasks_column_id_fkey
  FOREIGN KEY (column_id) REFERENCES columns(id)
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS project_invitations (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role workspace_role NOT NULL,
  invited_by_user_id UUID NOT NULL,
  token TEXT NOT NULL UNIQUE,
  status invitation_status NOT NULL DEFAULT 'PENDING',
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS project_settings (
  project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  default_view project_view_type NOT NULL DEFAULT 'BOARD',
  allow_member_invite BOOLEAN NOT NULL DEFAULT false,
  allow_comment BOOLEAN NOT NULL DEFAULT true,
  allow_viewer_comment BOOLEAN NOT NULL DEFAULT false,
  allow_task_reorder BOOLEAN NOT NULL DEFAULT true,
  allow_task_delete_by_member BOOLEAN NOT NULL DEFAULT false,
  task_prefix VARCHAR(20),
  theme_color VARCHAR(32),
  is_private_by_default BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY,
  recipient_user_id UUID NOT NULL,
  actor_user_id UUID,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  type notification_type NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  payload JSONB,
  is_read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO project_settings (project_id)
SELECT p.id
FROM projects p
LEFT JOIN project_settings ps ON ps.project_id = p.id
WHERE ps.project_id IS NULL;

CREATE INDEX IF NOT EXISTS workspaces_status_idx ON workspaces(status);
CREATE INDEX IF NOT EXISTS projects_visibility_idx ON projects(visibility);
CREATE INDEX IF NOT EXISTS projects_owner_user_id_idx ON projects(owner_user_id);
CREATE INDEX IF NOT EXISTS workspace_members_status_idx ON workspace_members(status);
CREATE INDEX IF NOT EXISTS project_members_status_idx ON project_members(status);
CREATE INDEX IF NOT EXISTS tasks_start_at_due_at_idx ON tasks(start_at, due_at);
CREATE INDEX IF NOT EXISTS tasks_completed_at_idx ON tasks(completed_at);
CREATE INDEX IF NOT EXISTS project_invitations_project_status_idx ON project_invitations(project_id, status);
CREATE INDEX IF NOT EXISTS project_invitations_email_idx ON project_invitations(email);
CREATE INDEX IF NOT EXISTS notifications_recipient_read_created_at_idx ON notifications(recipient_user_id, is_read, created_at);
CREATE INDEX IF NOT EXISTS notifications_project_created_at_idx ON notifications(project_id, created_at);
CREATE INDEX IF NOT EXISTS notifications_task_created_at_idx ON notifications(task_id, created_at);
