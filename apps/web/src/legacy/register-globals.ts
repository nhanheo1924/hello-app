import { createAuthCompat } from '../core/auth/auth-api';
import { createSessionSyncCompat } from '../core/sync/session-sync';
import { createRealtimeSyncCompat } from '../core/sync/realtime-sync';
import { createTaskApiCompat } from '../modules/tasks/task-api';
import * as ProfileApi from '../modules/profile/profile-api';
import * as RolePermissions from '../modules/permissions/role-permissions';
import * as WorkspaceApi from '../modules/workspace/workspace-api';
import * as ProjectApi from '../modules/project/project-api';
import * as MembershipApi from '../modules/membership/membership-api';
import * as TaskFeatureApi from '../modules/task/task-api';
import * as CalendarApi from '../modules/calendar/calendar-api';
import { createGovernanceApiCompat } from '../modules/governance/governance-api';
import { bootstrapAppI18n, type OrbitI18nCompat } from '../core/i18n/app-i18n';

declare global {
  interface Window {
    OrbitAuth: ReturnType<typeof createAuthCompat>;
    OrbitTaskApi: ReturnType<typeof createTaskApiCompat>;
    OrbitSessionSync: ReturnType<typeof createSessionSyncCompat>;
    OrbitRealtimeSync: ReturnType<typeof createRealtimeSyncCompat>;
    OrbitProfileApi: typeof ProfileApi;
    OrbitPermissions: typeof RolePermissions;
    OrbitWorkspaceApi: typeof WorkspaceApi;
    OrbitProjectApi: typeof ProjectApi;
    OrbitMembershipApi: typeof MembershipApi;
    OrbitTaskFeatureApi: typeof TaskFeatureApi;
    OrbitCalendarApi: typeof CalendarApi;
    OrbitGovernanceApi: ReturnType<typeof createGovernanceApiCompat>;
    OrbitI18n?: OrbitI18nCompat;
  }
}

export function registerLegacyGlobals(): void {
  window.OrbitAuth = createAuthCompat();
  window.OrbitTaskApi = createTaskApiCompat();
  window.OrbitSessionSync = createSessionSyncCompat();
  window.OrbitRealtimeSync = createRealtimeSyncCompat();
  window.OrbitProfileApi = ProfileApi;
  window.OrbitPermissions = RolePermissions;
  window.OrbitWorkspaceApi = WorkspaceApi;
  window.OrbitProjectApi = ProjectApi;
  window.OrbitMembershipApi = MembershipApi;
  window.OrbitTaskFeatureApi = TaskFeatureApi;
  window.OrbitCalendarApi = CalendarApi;
  window.OrbitGovernanceApi = createGovernanceApiCompat();
  window.OrbitI18n = bootstrapAppI18n();
}
