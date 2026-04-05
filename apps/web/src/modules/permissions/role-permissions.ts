export type WorkspaceRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
export type SystemRole = 'SUPER_ADMIN' | 'SYSTEM_ADMIN' | 'USER';

export type PermissionContext = {
  systemRole?: string | null;
  workspaceRole?: string | null;
  projectRole?: string | null;
};

const WORKSPACE_INVITEABLE_ROLES: WorkspaceRole[] = ['ADMIN', 'MEMBER', 'VIEWER'];
const MEMBER_INVITEABLE_ROLES: WorkspaceRole[] = ['MEMBER', 'VIEWER'];

function toRole(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function isSystemAdmin(context: PermissionContext): boolean {
  const systemRole = toRole(context.systemRole);
  return systemRole === 'SUPER_ADMIN' || systemRole === 'SYSTEM_ADMIN';
}

function getWorkspaceRole(context: PermissionContext): WorkspaceRole | '' {
  const workspaceRole = toRole(context.workspaceRole);
  if (
    workspaceRole === 'OWNER' ||
    workspaceRole === 'ADMIN' ||
    workspaceRole === 'MEMBER' ||
    workspaceRole === 'VIEWER'
  ) {
    return workspaceRole;
  }
  return '';
}

function getNormalizedWorkspaceInviteRole(value: unknown): WorkspaceRole | '' {
  const normalized = toRole(value);
  if (
    normalized === 'OWNER' ||
    normalized === 'ADMIN' ||
    normalized === 'MEMBER' ||
    normalized === 'VIEWER'
  ) {
    return normalized;
  }
  return '';
}

export function canInviteWorkspaceMembers(context: PermissionContext): boolean {
  if (isSystemAdmin(context)) {
    return true;
  }
  const workspaceRole = getWorkspaceRole(context);
  return (
    workspaceRole === 'OWNER' ||
    workspaceRole === 'ADMIN' ||
    workspaceRole === 'MEMBER'
  );
}

export function canEditWorkspaceMemberRoles(context: PermissionContext): boolean {
  if (isSystemAdmin(context)) {
    return true;
  }
  const workspaceRole = getWorkspaceRole(context);
  return workspaceRole === 'OWNER' || workspaceRole === 'ADMIN';
}

export function canRemoveWorkspaceMembers(context: PermissionContext): boolean {
  return canEditWorkspaceMemberRoles(context);
}

export function canAssignWorkspaceInviteRole(
  context: PermissionContext,
  role: unknown,
): boolean {
  const normalizedRole = getNormalizedWorkspaceInviteRole(role);
  if (!normalizedRole || normalizedRole === 'OWNER') {
    return false;
  }

  if (canEditWorkspaceMemberRoles(context)) {
    return WORKSPACE_INVITEABLE_ROLES.includes(normalizedRole);
  }

  const workspaceRole = getWorkspaceRole(context);
  if (workspaceRole === 'MEMBER') {
    return MEMBER_INVITEABLE_ROLES.includes(normalizedRole);
  }
  return false;
}

export function getWorkspaceInviteRoleOptions(
  context: PermissionContext,
): WorkspaceRole[] {
  if (canEditWorkspaceMemberRoles(context)) {
    return [...WORKSPACE_INVITEABLE_ROLES];
  }
  const workspaceRole = getWorkspaceRole(context);
  if (workspaceRole === 'MEMBER') {
    return [...MEMBER_INVITEABLE_ROLES];
  }
  return [];
}

export function canManageWorkspaceMembers(context: PermissionContext): boolean {
  return canEditWorkspaceMemberRoles(context);
}

export function canManageProjectSettings(context: PermissionContext): boolean {
  if (isSystemAdmin(context)) {
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
  if (isSystemAdmin(context)) {
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
