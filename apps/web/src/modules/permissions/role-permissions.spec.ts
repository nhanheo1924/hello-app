import { describe, expect, it } from 'vitest';
import {
  canEditTask,
  canManageProjectSettings,
  canManageWorkspaceMembers,
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
    expect(canManageProjectSettings(context)).toBe(false);
    expect(canEditTask(context)).toBe(false);
    expect(isReadOnly(context)).toBe(true);
  });

  it('allows member task edit but not member management by default', () => {
    const context = {
      systemRole: 'USER',
      workspaceRole: 'MEMBER',
      projectRole: 'MEMBER',
    };

    expect(canManageWorkspaceMembers(context)).toBe(false);
    expect(canManageProjectSettings(context)).toBe(false);
    expect(canEditTask(context)).toBe(true);
    expect(isReadOnly(context)).toBe(false);
  });
});
