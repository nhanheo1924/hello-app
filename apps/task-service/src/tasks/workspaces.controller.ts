import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AddMemberByEmailDto } from "./dto/add-member-by-email.dto";
import { BoardQueryDto } from "./dto/board-query.dto";
import { CalendarQueryDto } from "./dto/calendar-query.dto";
import { CreateTaskDto } from "./dto/create-task.dto";
import { CreateProjectDto } from "./dto/create-project.dto";
import { CreateWorkspaceDto } from "./dto/create-workspace.dto";
import { PaginationQueryDto } from "./dto/pagination-query.dto";
import { UpdateMemberRoleDto } from "./dto/update-member-role.dto";
import { UpdateWorkspaceDto } from "./dto/update-workspace.dto";
import { UpdateWorkspaceSettingsDto } from "./dto/update-workspace-settings.dto";
import { TasksService } from "./tasks.service";

@Controller("workspaces")
@UseGuards(JwtAuthGuard)
export class WorkspacesController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  list(
    @CurrentUser("userId") userId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.tasksService.listWorkspaces(userId, query.page, query.limit);
  }

  @Post()
  create(
    @CurrentUser("userId") userId: string,
    @Body() dto: CreateWorkspaceDto,
  ) {
    return this.tasksService.createWorkspace(userId, dto);
  }

  @Get(":workspaceId")
  getById(
    @CurrentUser("userId") userId: string,
    @Param("workspaceId") workspaceId: string,
  ) {
    return this.tasksService.getWorkspace(userId, workspaceId);
  }

  @Patch(":workspaceId")
  update(
    @CurrentUser("userId") userId: string,
    @Param("workspaceId") workspaceId: string,
    @Body() dto: UpdateWorkspaceDto,
  ) {
    return this.tasksService.updateWorkspace(userId, workspaceId, dto);
  }

  @Get(":workspaceId/settings")
  getSettings(
    @CurrentUser("userId") userId: string,
    @Param("workspaceId") workspaceId: string,
  ) {
    return this.tasksService.getWorkspaceSettings(userId, workspaceId);
  }

  @Patch(":workspaceId/settings")
  updateSettings(
    @CurrentUser("userId") userId: string,
    @Param("workspaceId") workspaceId: string,
    @Body() dto: UpdateWorkspaceSettingsDto,
  ) {
    return this.tasksService.updateWorkspaceSettings(userId, workspaceId, dto);
  }

  @Delete(":workspaceId")
  delete(
    @CurrentUser("userId") userId: string,
    @Param("workspaceId") workspaceId: string,
  ) {
    return this.tasksService.deleteWorkspace(userId, workspaceId);
  }

  @Get(":workspaceId/projects")
  listProjects(
    @CurrentUser("userId") userId: string,
    @Param("workspaceId") workspaceId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.tasksService.listProjects(
      userId,
      workspaceId,
      query.page,
      query.limit,
    );
  }

  @Post(":workspaceId/projects")
  createProject(
    @CurrentUser("userId") userId: string,
    @Param("workspaceId") workspaceId: string,
    @Body() dto: CreateProjectDto,
  ) {
    return this.tasksService.createProject(userId, workspaceId, dto);
  }

  @Get(":workspaceId/members")
  listMembers(
    @CurrentUser("userId") userId: string,
    @Param("workspaceId") workspaceId: string,
  ) {
    return this.tasksService.listWorkspaceMembers(userId, workspaceId);
  }

  @Post(":workspaceId/members")
  addMember(
    @CurrentUser("userId") userId: string,
    @Param("workspaceId") workspaceId: string,
    @Body() dto: AddMemberByEmailDto,
  ) {
    return this.tasksService.addWorkspaceMemberByEmail(
      userId,
      workspaceId,
      dto,
    );
  }

  @Patch(":workspaceId/members/:memberUserId/role")
  updateMemberRole(
    @CurrentUser("userId") userId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("memberUserId") memberUserId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.tasksService.updateWorkspaceMemberRole(
      userId,
      workspaceId,
      memberUserId,
      dto,
    );
  }

  @Delete(":workspaceId/members/:memberUserId")
  removeMember(
    @CurrentUser("userId") userId: string,
    @Param("workspaceId") workspaceId: string,
    @Param("memberUserId") memberUserId: string,
  ) {
    return this.tasksService.removeWorkspaceMember(
      userId,
      workspaceId,
      memberUserId,
    );
  }

  @Get(":workspaceId/board")
  board(
    @CurrentUser("userId") userId: string,
    @CurrentUser("systemRole") systemRole: string | undefined,
    @Param("workspaceId") workspaceId: string,
    @Query() query: BoardQueryDto,
  ) {
    return this.tasksService.getWorkspaceBoard(
      userId,
      systemRole,
      workspaceId,
      query,
    );
  }

  @Get(":workspaceId/calendar")
  calendar(
    @CurrentUser("userId") userId: string,
    @CurrentUser("systemRole") systemRole: string | undefined,
    @Param("workspaceId") workspaceId: string,
    @Query() query: CalendarQueryDto,
  ) {
    return this.tasksService.getWorkspaceCalendar(
      userId,
      systemRole,
      workspaceId,
      query,
    );
  }

  @Post(":workspaceId/tasks")
  createTask(
    @CurrentUser("userId") userId: string,
    @CurrentUser("systemRole") systemRole: string | undefined,
    @Param("workspaceId") workspaceId: string,
    @Body() dto: CreateTaskDto,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.tasksService.createWorkspaceTask(
      userId,
      systemRole,
      workspaceId,
      dto,
      idempotencyKey,
    );
  }
}
