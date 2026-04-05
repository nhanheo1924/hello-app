import { All, Controller, Param, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { ProxyService } from "./proxy.service";

@Controller()
export class ProxyController {
  constructor(private readonly proxyService: ProxyService) {}

  @All(["auth", "auth/*path"])
  async proxyAuth(
    @Req() request: Request,
    @Res() response: Response,
    @Param("path") path?: string | string[],
  ): Promise<void> {
    const suffix = this.normalizePathParam(path);
    await this.proxyService.forward(request, response, {
      upstream: "auth",
      upstreamPath: suffix,
    });
  }

  @All(["admin", "admin/*path"])
  async proxyAdminTask(
    @Req() request: Request,
    @Res() response: Response,
    @Param("path") path?: string | string[],
  ): Promise<void> {
    const suffix = this.normalizePathParam(path);
    await this.proxyService.forward(request, response, {
      upstream: "task",
      upstreamPath: suffix ? `admin/${suffix}` : "admin",
    });
  }

  @All(["workspaces", "workspaces/*path"])
  async proxyWorkspaces(
    @Req() request: Request,
    @Res() response: Response,
    @Param("path") path?: string | string[],
  ): Promise<void> {
    const suffix = this.normalizePathParam(path);
    await this.proxyService.forward(request, response, {
      upstream: "task",
      upstreamPath: suffix ? `workspaces/${suffix}` : "workspaces",
    });
  }

  @All(["projects", "projects/*path"])
  async proxyProjects(
    @Req() request: Request,
    @Res() response: Response,
    @Param("path") path?: string | string[],
  ): Promise<void> {
    const suffix = this.normalizePathParam(path);
    await this.proxyService.forward(request, response, {
      upstream: "task",
      upstreamPath: suffix ? `projects/${suffix}` : "projects",
    });
  }

  @All(["tasks", "tasks/*path"])
  async proxyTasks(
    @Req() request: Request,
    @Res() response: Response,
    @Param("path") path?: string | string[],
  ): Promise<void> {
    const suffix = this.normalizePathParam(path);
    await this.proxyService.forward(request, response, {
      upstream: "task",
      upstreamPath: suffix ? `tasks/${suffix}` : "tasks",
    });
  }

  @All(["notifications", "notifications/*path"])
  async proxyNotifications(
    @Req() request: Request,
    @Res() response: Response,
    @Param("path") path?: string | string[],
  ): Promise<void> {
    const suffix = this.normalizePathParam(path);
    await this.proxyService.forward(request, response, {
      upstream: "task",
      upstreamPath: suffix ? `notifications/${suffix}` : "notifications",
    });
  }

  @All(["saved-views", "saved-views/*path"])
  async proxySavedViews(
    @Req() request: Request,
    @Res() response: Response,
    @Param("path") path?: string | string[],
  ): Promise<void> {
    const suffix = this.normalizePathParam(path);
    await this.proxyService.forward(request, response, {
      upstream: "task",
      upstreamPath: suffix ? `saved-views/${suffix}` : "saved-views",
    });
  }

  @All(["templates", "templates/*path"])
  async proxyTemplates(
    @Req() request: Request,
    @Res() response: Response,
    @Param("path") path?: string | string[],
  ): Promise<void> {
    const suffix = this.normalizePathParam(path);
    await this.proxyService.forward(request, response, {
      upstream: "task",
      upstreamPath: suffix ? `templates/${suffix}` : "templates",
    });
  }

  private normalizePathParam(path: string | string[] | undefined): string {
    if (Array.isArray(path)) {
      return path
        .map((part) => String(part || "").trim())
        .filter((part) => part.length > 0)
        .join("/");
    }

    return String(path || "").trim();
  }
}
