SET search_path TO "task";

CREATE TABLE IF NOT EXISTS workspace_settings (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  start_date DATE,
  end_date DATE,
  hour_format VARCHAR(2) NOT NULL DEFAULT '24',
  show_weekends BOOLEAN NOT NULL DEFAULT true,
  week_start VARCHAR(3) NOT NULL DEFAULT 'mon',
  default_duration_hours DOUBLE PRECISION NOT NULL DEFAULT 2,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO workspace_settings (workspace_id)
SELECT w.id
FROM workspaces w
LEFT JOIN workspace_settings ws ON ws.workspace_id = w.id
WHERE ws.workspace_id IS NULL;
