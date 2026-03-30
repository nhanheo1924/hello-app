import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTask, getBoard } from './task-api';
import { httpRequest } from '../../core/http/client';
import { getToken } from '../../core/auth/session';

vi.mock('../../core/http/client', () => ({
  httpRequest: vi.fn(),
}));

vi.mock('../../core/auth/session', () => ({
  getToken: vi.fn(),
}));

vi.mock('../../config/api', () => ({
  API_BASE_URL: '/api/v1',
}));

const httpRequestMock = vi.mocked(httpRequest);
const getTokenMock = vi.mocked(getToken);

describe('task api compat', () => {
  beforeEach(() => {
    httpRequestMock.mockReset();
    getTokenMock.mockReset();
    getTokenMock.mockReturnValue('token-1');
    (globalThis as { window?: unknown }).window = {};
  });

  it('maps legacy assigneeId to assigneeUserId on create task payload', async () => {
    httpRequestMock.mockResolvedValueOnce({
      data: {
        id: 'task-1',
        assigneeUserId: 'user-2',
        createdByUserId: 'user-1',
      },
    });

    const response = await createTask('project-1', {
      title: 'Task',
      assigneeId: 'user-2',
    });

    expect(httpRequestMock).toHaveBeenCalledTimes(1);
    const requestOptions = httpRequestMock.mock.calls[0][1] as {
      body?: string;
    };
    const requestBody = JSON.parse(requestOptions.body || '{}') as {
      assigneeUserId?: string;
    };
    expect(requestBody.assigneeUserId).toBe('user-2');
    expect((response as Record<string, unknown>).assigneeId).toBe('user-2');
    expect((response as Record<string, unknown>).createdBy).toBe('user-1');
  });

  it('adds legacy aliases for board tasks', async () => {
    httpRequestMock.mockResolvedValueOnce({
      data: {
        columns: [
          {
            id: 'column-1',
            tasks: [
              {
                id: 'task-1',
                assigneeUserId: 'user-2',
                createdByUserId: 'user-1',
              },
            ],
          },
        ],
      },
    });

    const board = (await getBoard('project-1')) as {
      columns: Array<{ tasks: Array<Record<string, unknown>> }>;
    };
    const task = board.columns[0]?.tasks[0] || {};

    expect(task.assigneeId).toBe('user-2');
    expect(task.createdBy).toBe('user-1');
  });
});
