import { getCalendar } from '../tasks/task-api';

export async function getProjectCalendar(projectId: string, from?: string, to?: string) {
  return getCalendar(projectId, from, to);
}

