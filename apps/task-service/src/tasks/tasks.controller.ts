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
import { CreateCommentDto } from "./dto/create-comment.dto";
import { CreateTaskDto } from "./dto/create-task.dto";
import { MoveTaskDto } from "./dto/move-task.dto";
import { PaginationQueryDto } from "./dto/pagination-query.dto";
import { UpdateTaskDto } from "./dto/update-task.dto";
import { TasksService } from "./tasks.service";

@Controller()
@UseGuards(JwtAuthGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post("projects/:projectId/tasks")
  createTask(
    @CurrentUser("userId") userId: string,
    @CurrentUser("systemRole") systemRole: string | undefined,
    @Param("projectId") projectId: string,
    @Body() dto: CreateTaskDto,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.tasksService.createTask(
      userId,
      systemRole,
      projectId,
      dto,
      idempotencyKey,
    );
  }

  @Patch("tasks/:taskId")
  updateTask(
    @CurrentUser("userId") userId: string,
    @CurrentUser("systemRole") systemRole: string | undefined,
    @Param("taskId") taskId: string,
    @Body() dto: UpdateTaskDto,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.tasksService.updateTask(
      userId,
      systemRole,
      taskId,
      dto,
      idempotencyKey,
    );
  }

  @Delete("tasks/:taskId")
  deleteTask(
    @CurrentUser("userId") userId: string,
    @CurrentUser("systemRole") systemRole: string | undefined,
    @Param("taskId") taskId: string,
  ) {
    return this.tasksService.deleteTask(userId, systemRole, taskId);
  }

  @Post("tasks/:taskId/move")
  moveTask(
    @CurrentUser("userId") userId: string,
    @CurrentUser("systemRole") systemRole: string | undefined,
    @Param("taskId") taskId: string,
    @Body() dto: MoveTaskDto,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.tasksService.moveTask(
      userId,
      systemRole,
      taskId,
      dto,
      idempotencyKey,
    );
  }

  @Get("tasks/:taskId/comments")
  listComments(
    @CurrentUser("userId") userId: string,
    @Param("taskId") taskId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.tasksService.listComments(
      userId,
      taskId,
      query.page,
      query.limit,
    );
  }

  @Post("tasks/:taskId/comments")
  createComment(
    @CurrentUser("userId") userId: string,
    @Param("taskId") taskId: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.tasksService.createComment(userId, taskId, dto);
  }
}
