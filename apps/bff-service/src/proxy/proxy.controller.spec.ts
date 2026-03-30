import type { Request, Response } from 'express';
import { ProxyController } from './proxy.controller';

describe('ProxyController', () => {
  function createController() {
    const proxyService = {
      forward: jest.fn().mockResolvedValue(undefined),
    };

    const controller = new ProxyController(proxyService as any);
    return { controller, proxyService };
  }

  function createReqRes() {
    return {
      request: {
        method: 'GET',
        url: '/api/v1/projects',
        originalUrl: '/api/v1/projects',
        headers: {},
      } as unknown as Request,
      response: {} as Response,
    };
  }

  it('forwards auth routes to auth upstream', async () => {
    const { controller, proxyService } = createController();
    const { request, response } = createReqRes();

    await controller.proxyAuth(request, response, 'profile');

    expect(proxyService.forward).toHaveBeenCalledWith(request, response, {
      upstream: 'auth',
      upstreamPath: 'profile',
    });
  });

  it('forwards workspace routes to task upstream with prefix', async () => {
    const { controller, proxyService } = createController();
    const { request, response } = createReqRes();

    await controller.proxyWorkspaces(request, response, '123/members');

    expect(proxyService.forward).toHaveBeenCalledWith(request, response, {
      upstream: 'task',
      upstreamPath: 'workspaces/123/members',
    });
  });

  it('forwards project routes to task upstream with prefix', async () => {
    const { controller, proxyService } = createController();
    const { request, response } = createReqRes();

    await controller.proxyProjects(request, response, 'p1/calendar');

    expect(proxyService.forward).toHaveBeenCalledWith(request, response, {
      upstream: 'task',
      upstreamPath: 'projects/p1/calendar',
    });
  });

  it('normalizes wildcard path arrays', async () => {
    const { controller, proxyService } = createController();
    const { request, response } = createReqRes();

    await controller.proxyTasks(request, response, [' ', 't1', 'move', '']);

    expect(proxyService.forward).toHaveBeenCalledWith(request, response, {
      upstream: 'task',
      upstreamPath: 'tasks/t1/move',
    });
  });

  it('forwards notifications routes to task upstream with prefix', async () => {
    const { controller, proxyService } = createController();
    const { request, response } = createReqRes();

    await controller.proxyNotifications(request, response, 'stream');

    expect(proxyService.forward).toHaveBeenCalledWith(request, response, {
      upstream: 'task',
      upstreamPath: 'notifications/stream',
    });
  });

  it('forwards saved views routes to task upstream with prefix', async () => {
    const { controller, proxyService } = createController();
    const { request, response } = createReqRes();

    await controller.proxySavedViews(request, response, 'view-1');

    expect(proxyService.forward).toHaveBeenCalledWith(request, response, {
      upstream: 'task',
      upstreamPath: 'saved-views/view-1',
    });
  });

  it('forwards template routes to task upstream with prefix', async () => {
    const { controller, proxyService } = createController();
    const { request, response } = createReqRes();

    await controller.proxyTemplates(request, response, 'template-1');

    expect(proxyService.forward).toHaveBeenCalledWith(request, response, {
      upstream: 'task',
      upstreamPath: 'templates/template-1',
    });
  });
});
