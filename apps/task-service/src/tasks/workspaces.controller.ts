import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { CreateProjectDto } from "./dto/create-project.dto";
import { CreateWorkspaceDto } from "./dto/create-workspace.dto";
import { PaginationQueryDto } from "./dto/pagination-query.dto";
import { UpdateWorkspaceDto } from "./dto/update-workspace.dto";
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
}
