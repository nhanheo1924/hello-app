import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ActivityQueryDto } from "./dto/activity-query.dto";
import {
  CreateProjectFromTemplateDto,
  CreateTemplateDto,
  UpdateTemplateDto,
} from "./dto/create-template.dto";
import { CreateSavedViewDto } from "./dto/create-saved-view.dto";
import {
  ReportBreakdownQueryDto,
  ReportExportQueryDto,
  ReportOverviewQueryDto,
} from "./dto/report-query.dto";
import { SearchQueryDto } from "./dto/search-query.dto";
import { UpdateSavedViewDto } from "./dto/update-saved-view.dto";
import { TasksService } from "./tasks.service";

@Controller()
@UseGuards(JwtAuthGuard)
export class GovernanceController {
  constructor(private readonly tasksService: TasksService) {}

  @Patch("projects/:projectId/archive")
  archiveProject(
    @CurrentUser("userId") userId: string,
    @CurrentUser("systemRole") systemRole: string | undefined,
    @Param("projectId") projectId: string,
  ) {
    return this.tasksService.archiveProject(userId, systemRole, projectId);
  }

  @Patch("projects/:projectId/restore")
  restoreProject(
    @CurrentUser("userId") userId: string,
    @CurrentUser("systemRole") systemRole: string | undefined,
    @Param("projectId") projectId: string,
  ) {
    return this.tasksService.restoreProject(userId, systemRole, projectId);
  }

  @Get("workspaces/:workspaceId/activities")
  workspaceActivities(
    @CurrentUser("userId") userId: string,
    @CurrentUser("systemRole") systemRole: string | undefined,
    @Param("workspaceId") workspaceId: string,
    @Query() query: ActivityQueryDto,
  ) {
    return this.tasksService.listWorkspaceActivities(
      userId,
      systemRole,
      workspaceId,
      query,
    );
  }

  @Get("projects/:projectId/activities")
  projectActivities(
    @CurrentUser("userId") userId: string,
    @CurrentUser("systemRole") systemRole: string | undefined,
    @Param("projectId") projectId: string,
    @Query() query: ActivityQueryDto,
  ) {
    return this.tasksService.listProjectActivities(
      userId,
      systemRole,
      projectId,
      query,
    );
  }

  @Get("workspaces/:workspaceId/search")
  search(
    @CurrentUser("userId") userId: string,
    @CurrentUser("systemRole") systemRole: string | undefined,
    @Param("workspaceId") workspaceId: string,
    @Query() query: SearchQueryDto,
  ) {
    return this.tasksService.searchWorkspace(userId, systemRole, workspaceId, query);
  }

  @Get("workspaces/:workspaceId/saved-views")
  listSavedViews(
    @CurrentUser("userId") userId: string,
    @CurrentUser("systemRole") systemRole: string | undefined,
    @Param("workspaceId") workspaceId: string,
  ) {
    return this.tasksService.listSavedViews(userId, systemRole, workspaceId);
  }

  @Post("workspaces/:workspaceId/saved-views")
  createSavedView(
    @CurrentUser("userId") userId: string,
    @CurrentUser("systemRole") systemRole: string | undefined,
    @Param("workspaceId") workspaceId: string,
    @Body() dto: CreateSavedViewDto,
  ) {
    return this.tasksService.createSavedView(
      userId,
      systemRole,
      workspaceId,
      dto,
    );
  }

  @Patch("saved-views/:savedViewId")
  updateSavedView(
    @CurrentUser("userId") userId: string,
    @CurrentUser("systemRole") systemRole: string | undefined,
    @Param("savedViewId") savedViewId: string,
    @Body() dto: UpdateSavedViewDto,
  ) {
    return this.tasksService.updateSavedView(userId, systemRole, savedViewId, dto);
  }

  @Delete("saved-views/:savedViewId")
  deleteSavedView(
    @CurrentUser("userId") userId: string,
    @CurrentUser("systemRole") systemRole: string | undefined,
    @Param("savedViewId") savedViewId: string,
  ) {
    return this.tasksService.deleteSavedView(userId, systemRole, savedViewId);
  }

  @Get("workspaces/:workspaceId/templates")
  listTemplates(
    @CurrentUser("userId") userId: string,
    @CurrentUser("systemRole") systemRole: string | undefined,
    @Param("workspaceId") workspaceId: string,
  ) {
    return this.tasksService.listProjectTemplates(userId, systemRole, workspaceId);
  }

  @Post("workspaces/:workspaceId/templates")
  createTemplate(
    @CurrentUser("userId") userId: string,
    @CurrentUser("systemRole") systemRole: string | undefined,
    @Param("workspaceId") workspaceId: string,
    @Body() dto: CreateTemplateDto,
  ) {
    return this.tasksService.createProjectTemplate(
      userId,
      systemRole,
      workspaceId,
      dto,
    );
  }

  @Patch("templates/:templateId")
  updateTemplate(
    @CurrentUser("userId") userId: string,
    @CurrentUser("systemRole") systemRole: string | undefined,
    @Param("templateId") templateId: string,
    @Body() dto: UpdateTemplateDto,
  ) {
    return this.tasksService.updateProjectTemplate(
      userId,
      systemRole,
      templateId,
      dto,
    );
  }

  @Delete("templates/:templateId")
  deleteTemplate(
    @CurrentUser("userId") userId: string,
    @CurrentUser("systemRole") systemRole: string | undefined,
    @Param("templateId") templateId: string,
  ) {
    return this.tasksService.deleteProjectTemplate(userId, systemRole, templateId);
  }

  @Post("workspaces/:workspaceId/projects/from-template")
  createProjectFromTemplate(
    @CurrentUser("userId") userId: string,
    @CurrentUser("systemRole") systemRole: string | undefined,
    @Param("workspaceId") workspaceId: string,
    @Body() body: { templateId: string } & CreateProjectFromTemplateDto,
  ) {
    return this.tasksService.createProjectFromTemplate(
      userId,
      systemRole,
      workspaceId,
      body.templateId,
      body,
    );
  }

  @Get("workspaces/:workspaceId/reports/overview")
  reportOverview(
    @CurrentUser("userId") userId: string,
    @CurrentUser("systemRole") systemRole: string | undefined,
    @Param("workspaceId") workspaceId: string,
    @Query() query: ReportOverviewQueryDto,
  ) {
    return this.tasksService.getReportOverview(
      userId,
      systemRole,
      workspaceId,
      query,
    );
  }

  @Get("workspaces/:workspaceId/reports/breakdown")
  reportBreakdown(
    @CurrentUser("userId") userId: string,
    @CurrentUser("systemRole") systemRole: string | undefined,
    @Param("workspaceId") workspaceId: string,
    @Query() query: ReportBreakdownQueryDto,
  ) {
    return this.tasksService.getReportBreakdown(
      userId,
      systemRole,
      workspaceId,
      query,
    );
  }

  @Get("workspaces/:workspaceId/reports/export.csv")
  async reportExportCsv(
    @CurrentUser("userId") userId: string,
    @CurrentUser("systemRole") systemRole: string | undefined,
    @Param("workspaceId") workspaceId: string,
    @Query() query: ReportExportQueryDto,
    @Res() response: Response,
  ) {
    const { filename, csv } = await this.tasksService.exportReportCsv(
      userId,
      systemRole,
      workspaceId,
      query,
    );
    response.setHeader("content-type", "text/csv; charset=utf-8");
    response.setHeader("content-disposition", `attachment; filename="${filename}"`);
    response.status(200).send(csv);
  }
}
