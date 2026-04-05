import { Controller, Get, Param, Post } from "@nestjs/common";
import { TasksService } from "./tasks.service";

@Controller("internal/admin")
export class InternalAdminController {
  constructor(private readonly tasksService: TasksService) {}

  @Get("users/:userId/workspace-ownership")
  getUserWorkspaceOwnership(@Param("userId") userId: string) {
    return this.tasksService.getInternalUserWorkspaceOwnership(userId);
  }

  @Post("users/:userId/cleanup")
  cleanupUserWorkspaceData(@Param("userId") userId: string) {
    return this.tasksService.cleanupUserWorkspaceData(userId);
  }
}
