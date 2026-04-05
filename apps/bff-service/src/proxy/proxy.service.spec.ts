import { ProxyService } from "./proxy.service";

describe("ProxyService invalidate behavior", () => {
  function createService() {
    const configService = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        if (key === "TASK_SERVICE_BASE_URL") return "http://task.local/api";
        if (key === "AUTH_SERVICE_BASE_URL")
          return "http://auth.local/api/auth";
        if (key === "INTERNAL_PROXY_SECRET") return "proxy-secret";
        if (key === "UPSTREAM_MAX_ATTEMPTS") return 1;
        if (key === "UPSTREAM_TIMEOUT_MS") return 5000;
        if (key === "UPSTREAM_RETRY_DELAY_MS") return 1;
        return defaultValue;
      }),
    } as any;

    const syncService = {
      publishInvalidateFromRequest: jest.fn(),
      publishInvalidate: jest.fn(),
      publishInvalidateMany: jest.fn(),
      publishAdminDelta: jest.fn(),
      publishAdminEvent: jest.fn(),
      publishWorkspaceTaskDelta: jest.fn(),
      buildUserKeyFromUserId: jest
        .fn()
        .mockImplementation((userId: string) => (userId ? `u:${userId}` : "")),
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
    response.clearCookie = jest.fn().mockReturnValue(response);
    response.cookie = jest.fn().mockReturnValue(response);
    return response as any;
  }

  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("publishes invalidate for successful task mutation", async () => {
    const { service, syncService } = createService();
    const request = {
      method: "POST",
      originalUrl: "/api/v1/projects/project-1/tasks",
      url: "/api/v1/projects/project-1/tasks",
      headers: {},
      query: {},
      body: {},
      requestId: "req-1",
    } as any;
    const response = createResponseMock();

    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { workspaceId: "11111111-1111-1111-1111-111111111111" },
        }),
        {
          status: 201,
          headers: { "content-type": "application/json" },
        },
      ),
    ) as any;

    await service.forward(request, response, {
      upstream: "task",
      upstreamPath: "projects/project-1/tasks",
    });

    expect(syncService.publishInvalidateFromRequest).toHaveBeenCalledTimes(1);
    expect(syncService.publishInvalidate).toHaveBeenCalledTimes(1);
  });

  it("does not publish invalidate for read-only request", async () => {
    const { service, syncService } = createService();
    const request = {
      method: "GET",
      originalUrl: "/api/v1/projects/project-1/board",
      url: "/api/v1/projects/project-1/board",
      headers: {},
      query: {},
      body: {},
      requestId: "req-2",
    } as any;
    const response = createResponseMock();

    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as any;

    await service.forward(request, response, {
      upstream: "task",
      upstreamPath: "projects/project-1/board",
    });

    expect(syncService.publishInvalidateFromRequest).not.toHaveBeenCalled();
    expect(syncService.publishInvalidate).not.toHaveBeenCalled();
  });

  it("removes unsupported hop-by-hop request headers before forwarding", async () => {
    const { service } = createService();
    const request = {
      method: "POST",
      originalUrl: "/api/v1/auth/login",
      url: "/api/v1/auth/login",
      headers: {
        connection: "keep-alive",
        "content-type": "application/json",
        expect: "100-continue",
      },
      query: {},
      body: {
        email: "nobody@example.com",
        password: "wrong-pass",
      },
      requestId: "req-3",
    } as any;
    const response = createResponseMock();

    const fetchMock = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "Invalid credentials",
          message: "Invalid credentials",
          code: "INVALID_CREDENTIALS",
        }),
        {
          status: 401,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    global.fetch = fetchMock as any;

    await service.forward(request, response, {
      upstream: "auth",
      upstreamPath: "login",
    });

    const forwardedHeaders = fetchMock.mock.calls[0][1].headers as Headers;
    expect(forwardedHeaders.get("expect")).toBeNull();
    expect(forwardedHeaders.get("connection")).toBeNull();
    expect(forwardedHeaders.get("x-proxy-secret")).toBe("proxy-secret");
    expect(response.status).toHaveBeenCalledWith(401);
  });

  it("keeps workspace member invalidate fanout when task delta payload is unavailable", async () => {
    const { service, syncService } = createService();
    const workspaceId = "11111111-1111-4111-8111-111111111111";
    const request = {
      method: "POST",
      originalUrl: `/api/v1/workspaces/${workspaceId}/tasks`,
      url: `/api/v1/workspaces/${workspaceId}/tasks`,
      headers: {},
      query: {},
      body: {},
      requestId: "req-4",
    } as any;
    const response = createResponseMock();

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { projectId: "project-1" } }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ userId: "member-1" }, { userId: "member-2" }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      ) as any;

    await service.forward(request, response, {
      upstream: "task",
      upstreamPath: `workspaces/${workspaceId}/tasks`,
    });

    expect(syncService.publishInvalidateMany).toHaveBeenCalledWith({
      userKeys: ["u:member-1", "u:member-2"],
      workspaceId,
      resource: "tasks",
    });
    expect(syncService.publishWorkspaceTaskDelta).not.toHaveBeenCalled();
  });

  it("includes workspaceId in admin deltas for task mutations", async () => {
    const { service, syncService } = createService();
    const workspaceId = "11111111-1111-4111-8111-111111111111";
    const request = {
      method: "PATCH",
      originalUrl: "/api/v1/tasks/task-1",
      url: "/api/v1/tasks/task-1",
      headers: {
        "x-workspace-id": workspaceId,
      },
      query: {},
      body: {},
      requestId: "req-5",
    } as any;
    const response = createResponseMock();

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: "task-1",
              title: "Task 1",
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ userId: "member-1" }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      ) as any;

    await service.forward(request, response, {
      upstream: "task",
      upstreamPath: "tasks/task-1",
    });

    expect(syncService.publishAdminDelta).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: "task",
        operation: "update",
        payload: expect.objectContaining({
          workspaceId,
        }),
      }),
    );
  });

  it("publishes admin realtime events for task mutations", async () => {
    const { service, syncService } = createService();
    const workspaceId = "11111111-1111-4111-8111-111111111111";
    const request = {
      method: "POST",
      originalUrl: `/api/v1/workspaces/${workspaceId}/tasks`,
      url: `/api/v1/workspaces/${workspaceId}/tasks`,
      headers: {},
      query: {},
      body: {},
      requestId: "req-7",
    } as any;
    const response = createResponseMock();

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: "task-11",
              projectId: "project-11",
              title: "Task 11",
            },
          }),
          {
            status: 201,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ userId: "member-1" }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      ) as any;

    await service.forward(request, response, {
      upstream: "task",
      upstreamPath: `workspaces/${workspaceId}/tasks`,
    });

    expect(syncService.publishAdminEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "task",
        outcome: "success",
        workspaceId,
        targetType: "task",
        targetId: "task-11",
      }),
    );
  });

  it("resolves workspace scope from projectId when task update has no workspace header", async () => {
    const { service, syncService } = createService();
    const workspaceId = "11111111-1111-4111-8111-111111111111";
    const request = {
      method: "PATCH",
      originalUrl: "/api/v1/tasks/task-9",
      url: "/api/v1/tasks/task-9",
      headers: {},
      query: {},
      body: {},
      requestId: "req-6",
    } as any;
    const response = createResponseMock();

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: "task-9",
              title: "Task 9",
              projectId: "project-9",
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              project: {
                workspaceId,
              },
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ userId: "member-1" }, { userId: "member-2" }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      ) as any;

    await service.forward(request, response, {
      upstream: "task",
      upstreamPath: "tasks/task-9",
    });

    expect(syncService.publishInvalidateFromRequest).toHaveBeenCalledWith(
      request,
      expect.objectContaining({
        workspaceId,
        resource: "tasks",
      }),
    );
    expect(syncService.publishInvalidateMany).toHaveBeenCalledWith({
      userKeys: ["u:member-1", "u:member-2"],
      workspaceId,
      resource: "tasks",
    });
    expect(syncService.publishWorkspaceTaskDelta).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        projectId: "project-9",
        taskId: "task-9",
        operation: "update",
      }),
    );
  });

  it("publishes admin realtime auth event for logout", async () => {
    const { service, syncService } = createService();
    const request = {
      method: "POST",
      originalUrl: "/api/v1/auth/logout",
      url: "/api/v1/auth/logout",
      headers: {},
      query: {},
      body: {},
      requestId: "req-8",
    } as any;
    const response = createResponseMock();

    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          message: "Logged out",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    ) as any;

    await service.forward(request, response, {
      upstream: "auth",
      upstreamPath: "logout",
    });

    expect(syncService.publishAdminEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "auth",
        action: "logout",
        outcome: "success",
      }),
    );
  });
});
