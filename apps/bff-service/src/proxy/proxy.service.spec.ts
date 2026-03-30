import { ProxyService } from './proxy.service';

describe('ProxyService invalidate behavior', () => {
  function createService() {
    const configService = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        if (key === 'TASK_SERVICE_BASE_URL') return 'http://task.local/api';
        if (key === 'AUTH_SERVICE_BASE_URL') return 'http://auth.local/api/auth';
        if (key === 'INTERNAL_PROXY_SECRET') return 'proxy-secret';
        if (key === 'UPSTREAM_MAX_ATTEMPTS') return 1;
        if (key === 'UPSTREAM_TIMEOUT_MS') return 5000;
        if (key === 'UPSTREAM_RETRY_DELAY_MS') return 1;
        return defaultValue;
      }),
    } as any;

    const syncService = {
      publishInvalidateFromRequest: jest.fn(),
      publishInvalidate: jest.fn(),
    } as any;

    const service = new ProxyService(configService, syncService);
    return { service, syncService };
  }

  function createResponseMock() {
    const response: Record<string, unknown> = {};
    response.status = jest.fn().mockReturnValue(response);
    response.setHeader = jest.fn();
    response.end = jest.fn();
    response.json = jest.fn().mockReturnValue(response);
    return response as any;
  }

  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('publishes invalidate for successful task mutation', async () => {
    const { service, syncService } = createService();
    const request = {
      method: 'POST',
      originalUrl: '/api/v1/projects/project-1/tasks',
      url: '/api/v1/projects/project-1/tasks',
      headers: {},
      query: {},
      body: {},
      requestId: 'req-1',
    } as any;
    const response = createResponseMock();

    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { workspaceId: '11111111-1111-1111-1111-111111111111' } }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    ) as any;

    await service.forward(request, response, {
      upstream: 'task',
      upstreamPath: 'projects/project-1/tasks',
    });

    expect(syncService.publishInvalidateFromRequest).toHaveBeenCalledTimes(1);
    expect(syncService.publishInvalidate).toHaveBeenCalledTimes(1);
  });

  it('does not publish invalidate for read-only request', async () => {
    const { service, syncService } = createService();
    const request = {
      method: 'GET',
      originalUrl: '/api/v1/projects/project-1/board',
      url: '/api/v1/projects/project-1/board',
      headers: {},
      query: {},
      body: {},
      requestId: 'req-2',
    } as any;
    const response = createResponseMock();

    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as any;

    await service.forward(request, response, {
      upstream: 'task',
      upstreamPath: 'projects/project-1/board',
    });

    expect(syncService.publishInvalidateFromRequest).not.toHaveBeenCalled();
    expect(syncService.publishInvalidate).not.toHaveBeenCalled();
  });
});
