import {
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { NotificationQueryDto } from "./dto/notification-query.dto";
import { TasksService } from "./tasks.service";

@Controller("notifications")
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  list(
    @CurrentUser("userId") userId: string,
    @Query() query: NotificationQueryDto,
  ) {
    return this.tasksService.listNotifications(
      userId,
      query.page,
      query.limit,
      query.unreadOnly,
    );
  }

  @Get("unread-count")
  unreadCount(@CurrentUser("userId") userId: string) {
    return this.tasksService.getNotificationUnreadCount(userId);
  }

  @Patch(":notificationId/read")
  markRead(
    @CurrentUser("userId") userId: string,
    @Param("notificationId") notificationId: string,
  ) {
    return this.tasksService.markNotificationRead(userId, notificationId);
  }

  @Patch("read-all")
  markReadAll(@CurrentUser("userId") userId: string) {
    return this.tasksService.markAllNotificationsRead(userId);
  }

  @Get("stream")
  stream(
    @CurrentUser("userId") userId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): void {
    this.tasksService.openNotificationStream(userId, request, response);
  }
}
