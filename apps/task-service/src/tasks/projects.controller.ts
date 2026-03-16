import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { BoardQueryDto } from "./dto/board-query.dto";
import { UpdateProjectDto } from "./dto/update-project.dto";
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
}
