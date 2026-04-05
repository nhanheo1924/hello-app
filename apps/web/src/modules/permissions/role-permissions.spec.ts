import { describe, expect, it } from 'vitest';
import {
  canAssignWorkspaceInviteRole,
  canEditTask,
  canEditWorkspaceMemberRoles,
  canInviteWorkspaceMembers,
  canManageProjectSettings,
  canManageWorkspaceMembers,
  canRemoveWorkspaceMembers,
  getWorkspaceInviteRoleOptions,
  isReadOnly,
} from './role-permissions';

describe('role permissions', () => {
  it('grants system admins management permissions', () => {
    const context = {
      systemRole: 'SYSTEM_ADMIN',
      workspaceRole: 'VIEWER',
      projectRole: 'VIEWER',
    };

    expect(canManageWorkspaceMembers(context)).toBe(true);
    expect(canInviteWorkspaceMembers(context)).toBe(true);
    expect(canEditWorkspaceMemberRoles(context)).toBe(true);
    expect(canRemoveWorkspaceMembers(context)).toBe(true);
    expect(canAssignWorkspaceInviteRole(context, 'ADMIN')).toBe(true);
    expect(canAssignWorkspaceInviteRole(context, 'OWNER')).toBe(false);
    expect(getWorkspaceInviteRoleOptions(context)).toEqual([
      'ADMIN',
      'MEMBER',
      'VIEWER',
    ]);
    expect(canManageProjectSettings(context)).toBe(true);
    expect(canEditTask(context)).toBe(true);
    expect(isReadOnly(context)).toBe(false);
  });

  it('keeps viewers read-only', () => {
    const context = {
      systemRole: 'USER',
      workspaceRole: 'VIEWER',
      projectRole: 'VIEWER',
    };

    expect(canManageWorkspaceMembers(context)).toBe(false);
    expect(canInviteWorkspaceMembers(context)).toBe(false);
    expect(canEditWorkspaceMemberRoles(context)).toBe(false);
    expect(canRemoveWorkspaceMembers(context)).toBe(false);
    expect(canAssignWorkspaceInviteRole(context, 'MEMBER')).toBe(false);
    expect(getWorkspaceInviteRoleOptions(context)).toEqual([]);
    expect(canManageProjectSettings(context)).toBe(false);
    expect(canEditTask(context)).toBe(false);
    expect(isReadOnly(context)).toBe(true);
  });

  it('allows member task edit and member-limited workspace invite only', () => {
    const context = {
      systemRole: 'USER',
      workspaceRole: 'MEMBER',
      projectRole: 'MEMBER',
    };

    expect(canManageWorkspaceMembers(context)).toBe(false);
    expect(canInviteWorkspaceMembers(context)).toBe(true);
    expect(canEditWorkspaceMemberRoles(context)).toBe(false);
    expect(canRemoveWorkspaceMembers(context)).toBe(false);
    expect(canAssignWorkspaceInviteRole(context, 'VIEWER')).toBe(true);
    expect(canAssignWorkspaceInviteRole(context, 'MEMBER')).toBe(true);
    expect(canAssignWorkspaceInviteRole(context, 'ADMIN')).toBe(false);
    expect(canAssignWorkspaceInviteRole(context, 'OWNER')).toBe(false);
    expect(getWorkspaceInviteRoleOptions(context)).toEqual(['MEMBER', 'VIEWER']);
    expect(canManageProjectSettings(context)).toBe(false);
    expect(canEditTask(context)).toBe(true);
    expect(isReadOnly(context)).toBe(false);
  });
});
