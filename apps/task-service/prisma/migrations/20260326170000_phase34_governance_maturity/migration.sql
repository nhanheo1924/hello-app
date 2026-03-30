SET search_path TO "task";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'saved_view_type') THEN
    CREATE TYPE saved_view_type AS ENUM ('BOARD', 'CALENDAR', 'LIST');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS saved_views (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL,
  name VARCHAR(120) NOT NULL,
  view_type saved_view_type NOT NULL DEFAULT 'BOARD',
  filters JSONB,
  sort JSONB,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS project_templates (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by_user_id UUID NOT NULL,
  name VARCHAR(120) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS project_template_columns (
  id UUID PRIMARY KEY,
  template_id UUID NOT NULL REFERENCES project_templates(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  position INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS project_template_labels (
  id UUID PRIMARY KEY,
  template_id UUID NOT NULL REFERENCES project_templates(id) ON DELETE CASCADE,
  name VARCHAR(80) NOT NULL,
  color VARCHAR(32) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS project_template_settings (
  template_id UUID PRIMARY KEY REFERENCES project_templates(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS saved_views_workspace_owner_idx ON saved_views(workspace_id, owner_user_id);
CREATE INDEX IF NOT EXISTS saved_views_workspace_type_idx ON saved_views(workspace_id, view_type);
CREATE INDEX IF NOT EXISTS project_templates_workspace_created_at_idx ON project_templates(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS project_template_columns_template_position_idx ON project_template_columns(template_id, position);
CREATE INDEX IF NOT EXISTS project_template_labels_template_name_idx ON project_template_labels(template_id, name);

CREATE INDEX IF NOT EXISTS projects_name_idx ON projects(name);
CREATE INDEX IF NOT EXISTS tasks_title_idx ON tasks(title);
CREATE INDEX IF NOT EXISTS labels_name_idx ON labels(name);
CREATE INDEX IF NOT EXISTS tasks_created_at_idx ON tasks(created_at);
CREATE INDEX IF NOT EXISTS tasks_completed_at_idx ON tasks(completed_at);
CREATE INDEX IF NOT EXISTS activities_created_at_idx ON activities(created_at);
