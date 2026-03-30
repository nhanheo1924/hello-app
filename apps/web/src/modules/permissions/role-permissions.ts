export type WorkspaceRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
export type SystemRole = 'SUPER_ADMIN' | 'SYSTEM_ADMIN' | 'USER';

export type PermissionContext = {
  systemRole?: string | null;
  workspaceRole?: string | null;
  projectRole?: string | null;
};

function toRole(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

export function canManageWorkspaceMembers(context: PermissionContext): boolean {
  const systemRole = toRole(context.systemRole);
  if (systemRole === 'SUPER_ADMIN' || systemRole === 'SYSTEM_ADMIN') {
    return true;
  }
  const workspaceRole = toRole(context.workspaceRole);
  return workspaceRole === 'OWNER' || workspaceRole === 'ADMIN';
}

export function canManageProjectSettings(context: PermissionContext): boolean {
  const systemRole = toRole(context.systemRole);
  if (systemRole === 'SUPER_ADMIN' || systemRole === 'SYSTEM_ADMIN') {
    return true;
  }

  const projectRole = toRole(context.projectRole);
  if (projectRole === 'OWNER' || projectRole === 'ADMIN') {
    return true;
  }

  const workspaceRole = toRole(context.workspaceRole);
  return workspaceRole === 'OWNER' || workspaceRole === 'ADMIN';
}

export function canEditTask(context: PermissionContext): boolean {
  const systemRole = toRole(context.systemRole);
  if (systemRole === 'SUPER_ADMIN' || systemRole === 'SYSTEM_ADMIN') {
    return true;
  }

  const projectRole = toRole(context.projectRole);
  if (projectRole === 'OWNER' || projectRole === 'ADMIN' || projectRole === 'MEMBER') {
    return true;
  }

  const workspaceRole = toRole(context.workspaceRole);
  return workspaceRole === 'OWNER' || workspaceRole === 'ADMIN' || workspaceRole === 'MEMBER';
}

export function isReadOnly(context: PermissionContext): boolean {
  return !canEditTask(context);
}
