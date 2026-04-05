import {
  Body,
  Controller,
  Delete,
  Get,
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
import { UpdateMemberRoleDto } from "./dto/update-member-role.dto";
import { UpdateProjectDto } from "./dto/update-project.dto";
import { UpdateProjectSettingsDto } from "./dto/update-project-settings.dto";
import { TasksService } from "./tasks.service";

@Controller("projects")
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(private readonly tasksService: TasksService) {}

  @Patch(":projectId")
  update(
    @CurrentUser("userId") userId: string,
    @Param("projectId") projectId: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.tasksService.updateProject(userId, projectId, dto);
  }

  @Delete(":projectId")
  remove(
    @CurrentUser("userId") userId: string,
    @Param("projectId") projectId: string,
  ) {
    return this.tasksService.deleteProject(userId, projectId);
  }

  @Get(":projectId/board")
  board(
    @CurrentUser("userId") userId: string,
    @Param("projectId") projectId: string,
    @Query() query: BoardQueryDto,
  ) {
    return this.tasksService.getBoard(userId, projectId, query);
  }

  @Get(":projectId/calendar")
  calendar(
    @CurrentUser("userId") userId: string,
    @Param("projectId") projectId: string,
    @Query() query: CalendarQueryDto,
  ) {
    return this.tasksService.getCalendar(userId, projectId, query);
  }

  @Get(":projectId/settings")
  getSettings(
    @CurrentUser("userId") userId: string,
    @Param("projectId") projectId: string,
  ) {
    return this.tasksService.getProjectSettings(userId, projectId);
  }

  @Patch(":projectId/settings")
  updateSettings(
    @CurrentUser("userId") userId: string,
    @Param("projectId") projectId: string,
    @Body() dto: UpdateProjectSettingsDto,
  ) {
    return this.tasksService.updateProjectSettings(userId, projectId, dto);
  }

  @Get(":projectId/members")
  listMembers(
    @CurrentUser("userId") userId: string,
    @Param("projectId") projectId: string,
  ) {
    return this.tasksService.listProjectMembers(userId, projectId);
  }

  @Post(":projectId/members")
  addMember(
    @CurrentUser("userId") userId: string,
    @Param("projectId") projectId: string,
    @Body() dto: AddMemberByEmailDto,
  ) {
    return this.tasksService.addProjectMemberByEmail(userId, projectId, dto);
  }

  @Patch(":projectId/members/:memberUserId/role")
  updateMemberRole(
    @CurrentUser("userId") userId: string,
    @Param("projectId") projectId: string,
    @Param("memberUserId") memberUserId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.tasksService.updateProjectMemberRole(
      userId,
      projectId,
      memberUserId,
      dto,
    );
  }

  @Delete(":projectId/members/:memberUserId")
  removeMember(
    @CurrentUser("userId") userId: string,
    @Param("projectId") projectId: string,
    @Param("memberUserId") memberUserId: string,
  ) {
    return this.tasksService.removeProjectMember(
      userId,
      projectId,
      memberUserId,
    );
  }
}
