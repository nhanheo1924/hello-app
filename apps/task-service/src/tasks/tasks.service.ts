import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  MembershipStatus,
  NotificationType,
  Prisma,
  ProjectViewType,
  SavedViewType,
  ProjectVisibility,
  ProjectStatus,
  Task,
  TaskPriority,
  TaskStatus,
  WorkspaceRole,
} from "@prisma/client";
import { createHash } from "crypto";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";
import { PrismaService } from "../prisma/prisma.service";
import { ActivityQueryDto } from "./dto/activity-query.dto";
import { AddMemberByEmailDto } from "./dto/add-member-by-email.dto";
import { BoardQueryDto } from "./dto/board-query.dto";
import { CalendarQueryDto } from "./dto/calendar-query.dto";
import {
  CreateProjectFromTemplateDto,
  CreateTemplateDto,
  UpdateTemplateDto,
} from "./dto/create-template.dto";
import { CreateSavedViewDto } from "./dto/create-saved-view.dto";
import { CreateCommentDto } from "./dto/create-comment.dto";
import { CreateProjectDto } from "./dto/create-project.dto";
import { CreateTaskDto } from "./dto/create-task.dto";
import { CreateWorkspaceDto } from "./dto/create-workspace.dto";
import { MoveTaskDto } from "./dto/move-task.dto";
import {
  ReportBreakdownDimension,
  ReportBreakdownQueryDto,
  ReportExportQueryDto,
  ReportExportType,
  ReportGroupBy,
  ReportOverviewQueryDto,
} from "./dto/report-query.dto";
import { SearchQueryDto } from "./dto/search-query.dto";
import { UpdateSavedViewDto } from "./dto/update-saved-view.dto";
import { UpdateProjectDto } from "./dto/update-project.dto";
import { UpdateProjectSettingsDto } from "./dto/update-project-settings.dto";
import { UpdateMemberRoleDto } from "./dto/update-member-role.dto";
import { UpdateTaskDto } from "./dto/update-task.dto";
import { UpdateWorkspaceDto } from "./dto/update-workspace.dto";

type PrismaTx = Prisma.TransactionClient;

type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

type WorkspaceContext = {
  id: string;
  role: WorkspaceRole;
};

type DirectoryUser = {
  id: string;
  email: string;
  displayName: string | null;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
};

const VIEW_ROLES: WorkspaceRole[] = [
  WorkspaceRole.OWNER,
  WorkspaceRole.ADMIN,
  WorkspaceRole.MEMBER,
  WorkspaceRole.VIEWER,
];
const EDIT_ROLES: WorkspaceRole[] = [
  WorkspaceRole.OWNER,
  WorkspaceRole.ADMIN,
  WorkspaceRole.MEMBER,
];
const ADMIN_ROLES: WorkspaceRole[] = [WorkspaceRole.OWNER, WorkspaceRole.ADMIN];
const SYSTEM_ADMIN_ROLES = new Set(["SUPER_ADMIN", "SYSTEM_ADMIN"]);

@Injectable()
export class TasksService {
  private readonly authInternalBaseUrl: string;
  private readonly internalProxySecret: string;
  private readonly notificationStreams = new Map<string, Set<Response>>();
  private readonly notificationHeartbeatTimers = new Map<Response, NodeJS.Timeout>();
  private lastDueNotificationSweepAt = 0;
  private readonly dueNotificationSweepWindowMs = 2 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.authInternalBaseUrl = String(
      this.configService.get<string>(
        "AUTH_SERVICE_INTERNAL_BASE_URL",
        "http://localhost:3000/api/internal",
      ),
    )
      .trim()
      .replace(/\/+$/, "");
    this.internalProxySecret = String(
      this.configService.get<string>("INTERNAL_PROXY_SECRET", ""),
    ).trim();
  }

  async listWorkspaces(userId: string, page?: number, limit?: number) {
    const pagination = this.resolvePagination(page, limit);
    const total = await this.prisma.workspaceMember.count({
      where: { userId, status: MembershipStatus.ACTIVE },
    });

    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId, status: MembershipStatus.ACTIVE },
      include: {
        workspace: {
          include: {
            _count: {
              select: {
                members: true,
                projects: true,
              },
            },
          },
        },
      },
      orderBy: {
        joinedAt: "desc",
      },
      skip: pagination.skip,
      take: pagination.limit,
    });

    return {
      data: memberships.map((membership) => ({
        id: membership.workspace.id,
        name: membership.workspace.name,
        ownerUserId: membership.workspace.ownerUserId,
        role: membership.role,
        memberCount: membership.workspace._count.members,
        projectCount: membership.workspace._count.projects,
        createdAt: membership.workspace.createdAt,
        updatedAt: membership.workspace.updatedAt,
      })),
      meta: this.toPaginationMeta(total, pagination.page, pagination.limit),
    };
  }

  async createWorkspace(userId: string, dto: CreateWorkspaceDto) {
    const name = dto.name.trim();
    const workspace = await this.prisma.$transaction(async (tx) => {
      const createdWorkspace = await tx.workspace.create({
        data: {
          name,
          ownerUserId: userId,
        },
      });
      await tx.workspaceMember.create({
        data: {
          workspaceId: createdWorkspace.id,
          userId,
          role: WorkspaceRole.OWNER,
          status: MembershipStatus.ACTIVE,
        },
      });
      const createdProject = await tx.project.create({
        data: {
          workspaceId: createdWorkspace.id,
          ownerUserId: userId,
          name,
          description: null,
          visibility: ProjectVisibility.WORKSPACE,
          defaultView: ProjectViewType.BOARD,
          createdByUserId: userId,
          updatedByUserId: userId,
          status: ProjectStatus.ACTIVE,
        },
      });
      await tx.taskColumn.createMany({
        data: [
          { projectId: createdProject.id, name: "Todo", position: 0 },
          { projectId: createdProject.id, name: "In Progress", position: 1 },
          { projectId: createdProject.id, name: "Done", position: 2 },
        ],
      });
      await tx.projectMember.create({
        data: {
          projectId: createdProject.id,
          userId,
          role: WorkspaceRole.OWNER,
          status: MembershipStatus.ACTIVE,
        },
      });
      await tx.projectSetting.create({
        data: {
          projectId: createdProject.id,
          defaultView: ProjectViewType.BOARD,
        },
      });
      await this.recordActivity(tx, {
        workspaceId: createdWorkspace.id,
        actorUserId: userId,
        action: "WORKSPACE_CREATED",
        entityType: "workspace",
        entityId: createdWorkspace.id,
        payload: {
          name: createdWorkspace.name,
          boardProjectId: createdProject.id,
        },
      });
      return createdWorkspace;
    });

    return {
      data: workspace,
    };
  }

  async getWorkspace(userId: string, workspaceId: string) {
    const context = await this.requireWorkspaceRole(
      userId,
      workspaceId,
      VIEW_ROLES,
    );
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: {
        _count: {
          select: {
            members: true,
            projects: true,
          },
        },
      },
    });

    if (!workspace) {
      throw new NotFoundException({
        code: "WORKSPACE_NOT_FOUND",
        message: "Workspace not found",
      });
    }

    return {
      data: {
        id: workspace.id,
        name: workspace.name,
        ownerUserId: workspace.ownerUserId,
        role: context.role,
        memberCount: workspace._count.members,
        projectCount: workspace._count.projects,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
      },
    };
  }

  async updateWorkspace(
    userId: string,
    workspaceId: string,
    dto: UpdateWorkspaceDto,
  ) {
    await this.requireWorkspaceRole(userId, workspaceId, ADMIN_ROLES);

    const data: Prisma.WorkspaceUpdateInput = {};
    if (dto.name !== undefined) {
      const trimmed = dto.name.trim();
      if (trimmed.length === 0) {
        throw new BadRequestException({
          code: "VALIDATION_ERROR",
          message: "Workspace name cannot be empty",
        });
      }
      data.name = trimmed;
    }

    if (Object.keys(data).length === 0) {
      return this.getWorkspace(userId, workspaceId);
    }

    const updated = await this.prisma.workspace.update({
      where: { id: workspaceId },
      data,
    });

    await this.recordActivity(this.prisma, {
      workspaceId: updated.id,
      actorUserId: userId,
      action: "WORKSPACE_UPDATED",
      entityType: "workspace",
      entityId: updated.id,
      payload: {
        updatedFields: Object.keys(data),
      },
    });

    return {
      data: updated,
    };
  }

  async deleteWorkspace(userId: string, workspaceId: string) {
    const context = await this.requireWorkspaceRole(
      userId,
      workspaceId,
      VIEW_ROLES,
    );

    if (context.role !== WorkspaceRole.OWNER) {
      throw new ForbiddenException({
        code: "WORKSPACE_DELETE_FORBIDDEN",
        message: "Only workspace owner can delete this workspace",
      });
    }

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        name: true,
      },
    });

    if (!workspace) {
      throw new NotFoundException({
        code: "WORKSPACE_NOT_FOUND",
        message: "Workspace not found",
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await this.recordActivity(tx, {
        workspaceId: workspace.id,
        actorUserId: userId,
        action: "WORKSPACE_DELETED",
        entityType: "workspace",
        entityId: workspace.id,
        payload: {
          name: workspace.name,
        },
      });

      await tx.workspace.delete({
        where: { id: workspace.id },
      });
    });

    return { success: true };
  }

  async listProjects(
    userId: string,
    workspaceId: string,
    page?: number,
    limit?: number,
  ) {
    const context = await this.requireWorkspaceRole(
      userId,
      workspaceId,
      VIEW_ROLES,
    );
    const pagination = this.resolvePagination(page, limit);

    const projectVisibilityWhere = this.buildProjectListWhere(
      workspaceId,
      userId,
      context.role,
    );

    const total = await this.prisma.project.count({
      where: projectVisibilityWhere,
    });

    const projects = await this.prisma.project.findMany({
      where: projectVisibilityWhere,
      include: {
        _count: {
          select: {
            tasks: true,
            columns: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      skip: pagination.skip,
      take: pagination.limit,
    });

    return {
      data: projects.map((project) => ({
        id: project.id,
        workspaceId: project.workspaceId,
        name: project.name,
        description: project.description,
        status: project.status,
        visibility: project.visibility,
        defaultView: project.defaultView,
        ownerUserId: project.ownerUserId,
        createdByUserId: project.createdByUserId,
        taskCount: project._count.tasks,
        columnCount: project._count.columns,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        workspaceRole: context.role,
      })),
      meta: this.toPaginationMeta(total, pagination.page, pagination.limit),
    };
  }

  async createProject(
    userId: string,
    workspaceId: string,
    dto: CreateProjectDto,
  ) {
    await this.requireWorkspaceRole(userId, workspaceId, EDIT_ROLES);

    const name = dto.name.trim();
    const description = dto.description?.trim() || null;

    const project = await this.prisma.$transaction(async (tx) => {
      const createdProject = await tx.project.create({
        data: {
          workspaceId,
          ownerUserId: userId,
          name,
          description,
          visibility: dto.visibility ?? ProjectVisibility.PRIVATE,
          defaultView: dto.defaultView ?? ProjectViewType.BOARD,
          createdByUserId: userId,
          updatedByUserId: userId,
          status: ProjectStatus.ACTIVE,
        },
      });

      await tx.taskColumn.createMany({
        data: [
          { projectId: createdProject.id, name: "Todo", position: 0 },
          { projectId: createdProject.id, name: "In Progress", position: 1 },
          { projectId: createdProject.id, name: "Done", position: 2 },
        ],
      });

      await tx.projectMember.create({
        data: {
          projectId: createdProject.id,
          userId,
          role: WorkspaceRole.OWNER,
          status: MembershipStatus.ACTIVE,
        },
      });

      await tx.projectSetting.create({
        data: {
          projectId: createdProject.id,
          defaultView: createdProject.defaultView,
        },
      });

      await this.recordActivity(tx, {
        workspaceId,
        projectId: createdProject.id,
        actorUserId: userId,
        action: "PROJECT_CREATED",
        entityType: "project",
        entityId: createdProject.id,
        payload: { name },
      });

      return tx.project.findUniqueOrThrow({
        where: { id: createdProject.id },
        include: {
          columns: {
            orderBy: { position: "asc" },
          },
        },
      });
    });

    return {
      data: project,
    };
  }

  async updateProject(
    userId: string,
    projectId: string,
    dto: UpdateProjectDto,
  ) {
    const { project } = await this.requireProjectAccess(userId, projectId, "admin");

    const data: Prisma.ProjectUpdateInput = {};
    if (dto.name !== undefined) {
      const trimmed = dto.name.trim();
      if (!trimmed) {
        throw new BadRequestException({
          code: "VALIDATION_ERROR",
          message: "Project name cannot be empty",
        });
      }
      data.name = trimmed;
    }
    if (dto.description !== undefined) {
      data.description = dto.description.trim() || null;
    }
    if (dto.status !== undefined) {
      data.status = dto.status;
    }
    if (dto.visibility !== undefined) {
      data.visibility = dto.visibility;
    }
    if (dto.defaultView !== undefined) {
      data.defaultView = dto.defaultView;
    }
    data.updatedByUserId = userId;

    if (Object.keys(data).length === 0) {
      return {
        data: project,
      };
    }

    const updated = await this.prisma.project.update({
      where: { id: projectId },
      data,
    });

    if (dto.defaultView !== undefined) {
      await this.prisma.projectSetting.upsert({
        where: { projectId },
        create: {
          projectId,
          defaultView: dto.defaultView,
        },
        update: {
          defaultView: dto.defaultView,
        },
      });
    }

    await this.recordActivity(this.prisma, {
      workspaceId: updated.workspaceId,
      projectId: updated.id,
      actorUserId: userId,
      action: "PROJECT_UPDATED",
      entityType: "project",
      entityId: updated.id,
      payload: {
        updatedFields: Object.keys(data),
      },
    });

    return {
      data: updated,
    };
  }

  async deleteProject(userId: string, projectId: string) {
    const { project } = await this.requireProjectAccess(userId, projectId, "admin");

    await this.prisma.$transaction(async (tx) => {
      await this.recordActivity(tx, {
        workspaceId: project.workspaceId,
        projectId: project.id,
        actorUserId: userId,
        action: "PROJECT_DELETED",
        entityType: "project",
        entityId: project.id,
        payload: {
          name: project.name,
        },
      });
      await tx.project.delete({
        where: {
          id: project.id,
        },
      });
    });

    return { success: true };
  }

  async getProjectSettings(userId: string, projectId: string) {
    const { project } = await this.requireProjectAccess(userId, projectId, "view");
    const settings = await this.prisma.projectSetting.upsert({
      where: { projectId },
      create: {
        projectId,
        defaultView: project.defaultView,
      },
      update: {},
    });
    return { data: settings };
  }

  async updateProjectSettings(
    userId: string,
    projectId: string,
    dto: UpdateProjectSettingsDto,
  ) {
    const { project } = await this.requireProjectAccess(userId, projectId, "admin");
    const updated = await this.prisma.projectSetting.upsert({
      where: { projectId },
      create: {
        projectId,
        defaultView: dto.defaultView ?? project.defaultView,
        allowMemberInvite: dto.allowMemberInvite ?? false,
        allowComment: dto.allowComment ?? true,
        allowViewerComment: dto.allowViewerComment ?? false,
        allowTaskReorder: dto.allowTaskReorder ?? true,
        allowTaskDeleteByMember: dto.allowTaskDeleteByMember ?? false,
        taskPrefix: dto.taskPrefix?.trim() || null,
        themeColor: dto.themeColor?.trim() || null,
        isPrivateByDefault: dto.isPrivateByDefault ?? true,
      },
      update: {
        ...(dto.defaultView !== undefined ? { defaultView: dto.defaultView } : {}),
        ...(dto.allowMemberInvite !== undefined
          ? { allowMemberInvite: dto.allowMemberInvite }
          : {}),
        ...(dto.allowComment !== undefined ? { allowComment: dto.allowComment } : {}),
        ...(dto.allowViewerComment !== undefined
          ? { allowViewerComment: dto.allowViewerComment }
          : {}),
        ...(dto.allowTaskReorder !== undefined
          ? { allowTaskReorder: dto.allowTaskReorder }
          : {}),
        ...(dto.allowTaskDeleteByMember !== undefined
          ? { allowTaskDeleteByMember: dto.allowTaskDeleteByMember }
          : {}),
        ...(dto.taskPrefix !== undefined
          ? { taskPrefix: dto.taskPrefix.trim() || null }
          : {}),
        ...(dto.themeColor !== undefined
          ? { themeColor: dto.themeColor.trim() || null }
          : {}),
        ...(dto.isPrivateByDefault !== undefined
          ? { isPrivateByDefault: dto.isPrivateByDefault }
          : {}),
      },
    });

    if (dto.defaultView !== undefined) {
      await this.prisma.project.update({
        where: { id: projectId },
        data: {
          defaultView: dto.defaultView,
          updatedByUserId: userId,
        },
      });
    }

    await this.recordActivity(this.prisma, {
      workspaceId: project.workspaceId,
      projectId,
      actorUserId: userId,
      action: "PROJECT_SETTINGS_UPDATED",
      entityType: "setting",
      entityId: projectId,
      payload: {
        updatedFields: Object.keys(dto),
      },
    });

    return { data: updated };
  }

  async getCalendar(userId: string, projectId: string, query: CalendarQueryDto) {
    const { project, workspaceRole, projectRole } = await this.requireProjectAccess(
      userId,
      projectId,
      "view",
    );

    const where: Prisma.TaskWhereInput = {
      projectId,
      archivedAt: null,
    };
    if (query.from || query.to) {
      where.OR = [
        {
          startAt: {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to ? { lte: new Date(query.to) } : {}),
          },
        },
        {
          dueAt: {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to ? { lte: new Date(query.to) } : {}),
          },
        },
      ];
    }

    const tasks = await this.prisma.task.findMany({
      where,
      include: {
        taskLabels: {
          include: { label: true },
        },
      },
      orderBy: [{ startAt: "asc" }, { dueAt: "asc" }, { createdAt: "asc" }],
    });

    return {
      data: {
        project: {
          id: project.id,
          workspaceId: project.workspaceId,
          name: project.name,
          visibility: project.visibility,
          defaultView: project.defaultView,
          workspaceRole,
          projectRole,
        },
        tasks: tasks.map((task) => ({
          ...task,
          labels: task.taskLabels.map((taskLabel) => taskLabel.label),
        })),
      },
    };
  }

  async getWorkspaceBoard(
    userId: string,
    systemRole: string | undefined,
    workspaceId: string,
    query: BoardQueryDto,
  ) {
    const projectId = await this.resolveWorkspacePrimaryProjectId(
      userId,
      workspaceId,
      "view",
      systemRole,
    );
    return this.getBoard(userId, projectId, query);
  }

  async getWorkspaceCalendar(
    userId: string,
    systemRole: string | undefined,
    workspaceId: string,
    query: CalendarQueryDto,
  ) {
    const projectId = await this.resolveWorkspacePrimaryProjectId(
      userId,
      workspaceId,
      "view",
      systemRole,
    );
    return this.getCalendar(userId, projectId, query);
  }

  async createWorkspaceTask(
    userId: string,
    systemRole: string | undefined,
    workspaceId: string,
    dto: CreateTaskDto,
  ) {
    const projectId = await this.resolveWorkspacePrimaryProjectId(
      userId,
      workspaceId,
      "edit",
      systemRole,
    );
    return this.createTask(userId, systemRole, projectId, dto);
  }

  async listWorkspaceMembers(userId: string, workspaceId: string) {
    await this.requireWorkspaceRole(userId, workspaceId, VIEW_ROLES);
    const members = await this.prisma.workspaceMember.findMany({
      where: {
        workspaceId,
        status: MembershipStatus.ACTIVE,
      },
      orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
    });
    return {
      data: await this.attachDirectoryProfiles(members),
    };
  }

  async addWorkspaceMemberByEmail(
    userId: string,
    workspaceId: string,
    dto: AddMemberByEmailDto,
  ) {
    await this.requireWorkspaceRole(userId, workspaceId, ADMIN_ROLES);
    const user = await this.lookupUserByEmail(dto.email);
    if (!user) {
      throw new BadRequestException({
        code: "USER_NOT_REGISTERED",
        message: "Email has not registered yet",
      });
    }

    const member = await this.prisma.workspaceMember.upsert({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: user.id,
        },
      },
      create: {
        workspaceId,
        userId: user.id,
        role: dto.role,
        status: MembershipStatus.ACTIVE,
        invitedByUserId: userId,
      },
      update: {
        role: dto.role,
        status: MembershipStatus.ACTIVE,
        invitedByUserId: userId,
      },
    });

    await this.recordActivity(this.prisma, {
      workspaceId,
      actorUserId: userId,
      action: "WORKSPACE_MEMBER_ADDED",
      entityType: "member",
      entityId: user.id,
      payload: {
        role: dto.role,
        email: user.email,
      },
    });

    return {
      data: this.withDirectoryProfile(member, user),
    };
  }

  async updateWorkspaceMemberRole(
    userId: string,
    workspaceId: string,
    memberUserId: string,
    dto: UpdateMemberRoleDto,
  ) {
    await this.requireWorkspaceRole(userId, workspaceId, ADMIN_ROLES);
    const member = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: memberUserId,
        },
      },
    });
    if (!member || member.status !== MembershipStatus.ACTIVE) {
      throw new NotFoundException({
        code: "WORKSPACE_MEMBER_NOT_FOUND",
        message: "Workspace member not found",
      });
    }

    const updated = await this.prisma.workspaceMember.update({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: memberUserId,
        },
      },
      data: { role: dto.role },
    });

    await this.recordActivity(this.prisma, {
      workspaceId,
      actorUserId: userId,
      action: "WORKSPACE_MEMBER_ROLE_UPDATED",
      entityType: "member",
      entityId: memberUserId,
      payload: { role: dto.role },
    });
    await this.pushNotification({
      recipientUserId: memberUserId,
      actorUserId: userId,
      workspaceId,
      type: NotificationType.ROLE_CHANGED,
      title: "Workspace role updated",
      body: `Your workspace role is now ${dto.role}.`,
      payload: { role: dto.role, scope: "workspace" },
    });

    const usersById = await this.lookupUsersByIds([updated.userId]);
    return {
      data: this.withDirectoryProfile(updated, usersById.get(updated.userId) ?? null),
    };
  }

  async removeWorkspaceMember(
    userId: string,
    workspaceId: string,
    memberUserId: string,
  ) {
    await this.requireWorkspaceRole(userId, workspaceId, ADMIN_ROLES);
    const member = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: memberUserId,
        },
      },
    });
    if (!member || member.status !== MembershipStatus.ACTIVE) {
      throw new NotFoundException({
        code: "WORKSPACE_MEMBER_NOT_FOUND",
        message: "Workspace member not found",
      });
    }
    if (member.role === WorkspaceRole.OWNER) {
      throw new BadRequestException({
        code: "OWNER_CANNOT_BE_REMOVED",
        message: "Workspace owner cannot be removed",
      });
    }

    await this.prisma.workspaceMember.update({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: memberUserId,
        },
      },
      data: {
        status: MembershipStatus.REMOVED,
      },
    });
    return { success: true };
  }

  async listProjectMembers(userId: string, projectId: string) {
    await this.requireProjectAccess(userId, projectId, "view");
    const members = await this.prisma.projectMember.findMany({
      where: {
        projectId,
        status: MembershipStatus.ACTIVE,
      },
      orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
    });
    return {
      data: await this.attachDirectoryProfiles(members),
    };
  }

  async addProjectMemberByEmail(
    userId: string,
    projectId: string,
    dto: AddMemberByEmailDto,
  ) {
    const access = await this.requireProjectAccess(userId, projectId, "view");
    const settings = await this.ensureProjectSettings(
      access.project.id,
      access.project.defaultView,
    );
    const canInvite =
      this.canProjectAdmin(access.workspaceRole, access.projectRole) ||
      (settings.allowMemberInvite &&
        this.canProjectEdit(access.workspaceRole, access.projectRole));
    if (!canInvite) {
      throw new ForbiddenException({
        code: "PROJECT_FORBIDDEN",
        message: "Project invitation is restricted",
      });
    }

    const project = access.project;
    const user = await this.lookupUserByEmail(dto.email);
    if (!user) {
      throw new BadRequestException({
        code: "USER_NOT_REGISTERED",
        message: "Email has not registered yet",
      });
    }
    if (dto.role === WorkspaceRole.OWNER && user.id !== project.ownerUserId) {
      throw new BadRequestException({
        code: "PROJECT_OWNER_IMMUTABLE",
        message: "Project owner is immutable",
      });
    }

    await this.prisma.workspaceMember.upsert({
      where: {
        workspaceId_userId: {
          workspaceId: project.workspaceId,
          userId: user.id,
        },
      },
      create: {
        workspaceId: project.workspaceId,
        userId: user.id,
        role: WorkspaceRole.MEMBER,
        status: MembershipStatus.ACTIVE,
        invitedByUserId: userId,
      },
      update: {
        status: MembershipStatus.ACTIVE,
      },
    });

    const member = await this.prisma.projectMember.upsert({
      where: {
        projectId_userId: {
          projectId,
          userId: user.id,
        },
      },
      create: {
        projectId,
        userId: user.id,
        role: dto.role,
        status: MembershipStatus.ACTIVE,
        invitedByUserId: userId,
      },
      update: {
        role: dto.role,
        status: MembershipStatus.ACTIVE,
        invitedByUserId: userId,
      },
    });

    await this.recordActivity(this.prisma, {
      workspaceId: project.workspaceId,
      projectId,
      actorUserId: userId,
      action: "PROJECT_MEMBER_ADDED",
      entityType: "member",
      entityId: user.id,
      payload: {
        role: dto.role,
        email: user.email,
      },
    });
    await this.pushNotification({
      recipientUserId: user.id,
      actorUserId: userId,
      workspaceId: project.workspaceId,
      projectId,
      type: NotificationType.PROJECT_INVITATION,
      title: "Added to project",
      body: `You were added to ${project.name}.`,
      payload: {
        role: dto.role,
      },
    });

    return {
      data: this.withDirectoryProfile(member, user),
    };
  }

  async updateProjectMemberRole(
    userId: string,
    projectId: string,
    memberUserId: string,
    dto: UpdateMemberRoleDto,
  ) {
    const access = await this.requireProjectAccess(userId, projectId, "admin");
    const member = await this.prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId: memberUserId,
        },
      },
    });
    if (!member || member.status !== MembershipStatus.ACTIVE) {
      throw new NotFoundException({
        code: "PROJECT_MEMBER_NOT_FOUND",
        message: "Project member not found",
      });
    }
    if (
      (dto.role === WorkspaceRole.OWNER &&
        memberUserId !== access.project.ownerUserId) ||
      (memberUserId === access.project.ownerUserId && dto.role !== WorkspaceRole.OWNER)
    ) {
      throw new BadRequestException({
        code: "PROJECT_OWNER_IMMUTABLE",
        message: "Project owner is immutable",
      });
    }
    const updated = await this.prisma.projectMember.update({
      where: {
        projectId_userId: {
          projectId,
          userId: memberUserId,
        },
      },
      data: {
        role: dto.role,
      },
    });
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { workspaceId: true, name: true },
    });
    if (project) {
      await this.recordActivity(this.prisma, {
        workspaceId: project.workspaceId,
        projectId,
        actorUserId: userId,
        action: "PROJECT_MEMBER_ROLE_UPDATED",
        entityType: "member",
        entityId: memberUserId,
        payload: { role: dto.role },
      });
      await this.pushNotification({
        recipientUserId: memberUserId,
        actorUserId: userId,
        workspaceId: project.workspaceId,
        projectId,
        type: NotificationType.ROLE_CHANGED,
        title: "Project role updated",
        body: `Your role in ${project.name} is now ${dto.role}.`,
        payload: { role: dto.role, scope: "project" },
      });
    }
    const usersById = await this.lookupUsersByIds([updated.userId]);
    return {
      data: this.withDirectoryProfile(updated, usersById.get(updated.userId) ?? null),
    };
  }

  async removeProjectMember(userId: string, projectId: string, memberUserId: string) {
    await this.requireProjectAccess(userId, projectId, "admin");
    const member = await this.prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId: memberUserId,
        },
      },
    });
    if (!member || member.status !== MembershipStatus.ACTIVE) {
      throw new NotFoundException({
        code: "PROJECT_MEMBER_NOT_FOUND",
        message: "Project member not found",
      });
    }
    if (member.role === WorkspaceRole.OWNER) {
      throw new BadRequestException({
        code: "OWNER_CANNOT_BE_REMOVED",
        message: "Project owner cannot be removed",
      });
    }
    await this.prisma.projectMember.update({
      where: {
        projectId_userId: {
          projectId,
          userId: memberUserId,
        },
      },
      data: {
        status: MembershipStatus.REMOVED,
      },
    });
    return { success: true };
  }

  async getBoard(userId: string, projectId: string, query: BoardQueryDto) {
    const { project, workspaceRole, projectRole } = await this.requireProjectAccess(
      userId,
      projectId,
      "view",
    );
    const taskWhere = this.buildBoardTaskWhere(project.id, query);

    const board = await this.prisma.project.findUniqueOrThrow({
      where: { id: project.id },
      include: {
        columns: {
          orderBy: {
            position: "asc",
          },
          include: {
            tasks: {
              where: taskWhere,
              orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
              include: {
                taskLabels: {
                  include: {
                    label: true,
                  },
                },
                _count: {
                  select: {
                    comments: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    return {
      data: {
        project: {
          id: board.id,
          workspaceId: board.workspaceId,
          name: board.name,
          description: board.description,
          status: board.status,
          visibility: board.visibility,
          defaultView: board.defaultView,
          createdByUserId: board.createdByUserId,
          createdAt: board.createdAt,
          updatedAt: board.updatedAt,
          workspaceRole,
          projectRole,
        },
        columns: board.columns.map((column) => ({
          id: column.id,
          projectId: column.projectId,
          name: column.name,
          position: column.position,
          tasks: column.tasks.map((task) => ({
            ...task,
            labels: task.taskLabels.map((taskLabel) => taskLabel.label),
            commentCount: task._count.comments,
          })),
        })),
        filters: {
          status: query.status ?? null,
          assigneeUserId: query.assigneeUserId ?? null,
          dueFrom: query.dueFrom ?? null,
          dueTo: query.dueTo ?? null,
          q: query.q ?? null,
        },
      },
    };
  }

  async createTask(
    userId: string,
    systemRole: string | undefined,
    projectId: string,
    dto: CreateTaskDto,
  ) {
    const access = await this.requireProjectAccess(
      userId,
      projectId,
      "edit",
      systemRole,
    );
    const { project } = access;
    this.assertMemberCreateOwnership(access, userId, dto.assigneeUserId);
    const assigneeUserId = dto.assigneeUserId ?? null;

    const task = await this.prisma.$transaction(async (tx) => {
      const targetColumnId = await this.resolveTargetColumnIdForCreate(
        tx,
        project.id,
        dto.columnId,
      );
      const orderIndex = await this.nextOrderIndex(tx, targetColumnId);

      const createdTask = await tx.task.create({
        data: {
          projectId: project.id,
          columnId: targetColumnId,
          title: dto.title.trim(),
          description: dto.description?.trim() || null,
          priority: dto.priority ?? TaskPriority.MEDIUM,
          status: dto.status ?? TaskStatus.TODO,
          startAt: dto.startAt ? new Date(dto.startAt) : null,
          dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
          allDay: dto.allDay ?? false,
          estimatedMinutes: dto.estimatedMinutes ?? null,
          completedAt:
            (dto.status ?? TaskStatus.TODO) === TaskStatus.DONE ? new Date() : null,
          completedByUserId:
            (dto.status ?? TaskStatus.TODO) === TaskStatus.DONE ? userId : null,
          assigneeUserId,
          orderIndex,
          createdByUserId: userId,
        },
      });

      await this.recordActivity(tx, {
        workspaceId: project.workspaceId,
        projectId: project.id,
        taskId: createdTask.id,
        actorUserId: userId,
        action: "TASK_CREATED",
        entityType: "task",
        entityId: createdTask.id,
        payload: {
          title: createdTask.title,
          columnId: createdTask.columnId,
        },
      });

      return createdTask;
    });

    if (task.assigneeUserId && task.assigneeUserId !== userId) {
      await this.pushNotification({
        recipientUserId: task.assigneeUserId,
        actorUserId: userId,
        workspaceId: project.workspaceId,
        projectId: project.id,
        taskId: task.id,
        type: NotificationType.TASK_ASSIGNED,
        title: "Task assigned",
        body: `You were assigned to ${task.title}.`,
      });
    }

    return {
      data: task,
    };
  }

  async updateTask(
    userId: string,
    systemRole: string | undefined,
    taskId: string,
    dto: UpdateTaskDto,
    idempotencyKey?: string,
  ) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        project: true,
      },
    });
    if (!task) {
      throw new NotFoundException({
        code: "TASK_NOT_FOUND",
        message: "Task not found",
      });
    }
    const access = await this.requireProjectAccess(
      userId,
      task.projectId,
      "edit",
      systemRole,
    );
    this.assertMemberTaskOwnership(access, userId, task, "update tasks");
    this.assertMemberAssigneeChange(access, userId, dto.assigneeUserId);

    const normalizedKey = this.normalizeIdempotencyKey(idempotencyKey);
    const payloadForIdempotency = {
      taskId,
      dto,
    };

    const previousAssigneeUserId = task.assigneeUserId ?? null;
    const result = await this.prisma.$transaction(async (tx) => {
      return this.runIdempotentMutation(
        tx,
        normalizedKey,
        userId,
        "TASK_UPDATE",
        payloadForIdempotency,
        async () => {
          const latest = await tx.task.findUnique({
            where: { id: taskId },
            include: {
              project: true,
            },
          });
          if (!latest) {
            throw new NotFoundException({
              code: "TASK_NOT_FOUND",
              message: "Task not found",
            });
          }

          const data: Prisma.TaskUncheckedUpdateInput = {};
          if (dto.title !== undefined) {
            const trimmed = dto.title.trim();
            if (!trimmed) {
              throw new BadRequestException({
                code: "VALIDATION_ERROR",
                message: "Task title cannot be empty",
              });
            }
            data.title = trimmed;
          }
          if (dto.description !== undefined) {
            data.description = dto.description.trim() || null;
          }
          if (dto.priority !== undefined) {
            data.priority = dto.priority;
          }
          if (dto.status !== undefined) {
            data.status = dto.status;
            if (dto.status === TaskStatus.DONE) {
              data.completedAt = new Date();
              data.completedByUserId = userId;
            }
            if (dto.status !== TaskStatus.DONE) {
              data.completedAt = null;
              data.completedByUserId = null;
            }
          }
          if (dto.startAt !== undefined) {
            data.startAt = dto.startAt ? new Date(dto.startAt) : null;
          }
          if (dto.dueAt !== undefined) {
            data.dueAt = dto.dueAt ? new Date(dto.dueAt) : null;
          }
          if (dto.allDay !== undefined) {
            data.allDay = dto.allDay;
          }
          if (dto.estimatedMinutes !== undefined) {
            data.estimatedMinutes = dto.estimatedMinutes;
          }
          if (dto.assigneeUserId !== undefined) {
            data.assigneeUserId = dto.assigneeUserId;
          }

          if (dto.columnId !== undefined && dto.columnId !== latest.columnId) {
            const column = await tx.taskColumn.findFirst({
              where: {
                id: dto.columnId,
                projectId: latest.projectId,
              },
            });
            if (!column) {
              throw new BadRequestException({
                code: "COLUMN_NOT_FOUND",
                message: "Target column not found in project",
              });
            }
            data.columnId = dto.columnId;
            data.orderIndex = await this.nextOrderIndex(tx, dto.columnId);
          }

          if (Object.keys(data).length === 0) {
            return {
              data: latest,
            };
          }

          const updated = await tx.task.update({
            where: { id: latest.id },
            data,
          });
          await this.recordActivity(tx, {
            workspaceId: latest.project.workspaceId,
            projectId: latest.projectId,
            taskId: latest.id,
            actorUserId: userId,
            action: "TASK_UPDATED",
            entityType: "task",
            entityId: latest.id,
            payload: {
              updatedFields: Object.keys(data),
            },
          });

          return {
            data: updated,
          };
        },
      );
    });

    const updatedTask = (result as { data?: Task })?.data;
    const nextAssigneeUserId =
      updatedTask && typeof updatedTask.assigneeUserId === "string"
        ? updatedTask.assigneeUserId
        : null;
    if (
      nextAssigneeUserId &&
      nextAssigneeUserId !== userId &&
      nextAssigneeUserId !== previousAssigneeUserId
    ) {
      await this.pushNotification({
        recipientUserId: nextAssigneeUserId,
        actorUserId: userId,
        workspaceId: task.project.workspaceId,
        projectId: task.projectId,
        taskId: task.id,
        type: NotificationType.TASK_ASSIGNED,
        title: "Task assigned",
        body: `You were assigned to ${updatedTask?.title || task.title}.`,
      });
    }

    return result;
  }

  async moveTask(
    userId: string,
    systemRole: string | undefined,
    taskId: string,
    dto: MoveTaskDto,
    idempotencyKey?: string,
  ) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        project: true,
      },
    });
    if (!task) {
      throw new NotFoundException({
        code: "TASK_NOT_FOUND",
        message: "Task not found",
      });
    }
    const access = await this.requireProjectAccess(
      userId,
      task.projectId,
      "edit",
      systemRole,
    );
    this.assertMemberTaskOwnership(access, userId, task, "move tasks");
    await this.assertMemberPolicyAllowed(
      access,
      "allowTaskReorder",
      "Task reorder is disabled for members",
    );

    const normalizedKey = this.normalizeIdempotencyKey(idempotencyKey);
    const payloadForIdempotency = {
      taskId,
      dto,
    };

    const result = await this.prisma.$transaction(async (tx) => {
      return this.runIdempotentMutation(
        tx,
        normalizedKey,
        userId,
        "TASK_MOVE",
        payloadForIdempotency,
        async () => {
          const latest = await tx.task.findUnique({
            where: { id: taskId },
            include: {
              project: true,
            },
          });
          if (!latest) {
            throw new NotFoundException({
              code: "TASK_NOT_FOUND",
              message: "Task not found",
            });
          }

          const targetColumn = await tx.taskColumn.findFirst({
            where: {
              id: dto.columnId,
              projectId: latest.projectId,
            },
          });
          if (!targetColumn) {
            throw new BadRequestException({
              code: "COLUMN_NOT_FOUND",
              message: "Target column not found in project",
            });
          }

          const oldColumnId = latest.columnId;
          const oldOrderIndex = latest.orderIndex;

          const targetCount = await tx.task.count({
            where: {
              columnId: dto.columnId,
              ...(dto.columnId === oldColumnId
                ? {
                    id: {
                      not: latest.id,
                    },
                  }
                : {}),
            },
          });
          const boundedTargetOrderIndex = this.clamp(
            dto.orderIndex,
            0,
            targetCount,
          );

          if (
            dto.columnId === oldColumnId &&
            boundedTargetOrderIndex === oldOrderIndex
          ) {
            return {
              data: latest,
            };
          }

          if (dto.columnId === oldColumnId) {
            if (boundedTargetOrderIndex > oldOrderIndex) {
              await tx.task.updateMany({
                where: {
                  columnId: oldColumnId,
                  orderIndex: {
                    gt: oldOrderIndex,
                    lte: boundedTargetOrderIndex,
                  },
                },
                data: {
                  orderIndex: {
                    decrement: 1,
                  },
                },
              });
            } else {
              await tx.task.updateMany({
                where: {
                  columnId: oldColumnId,
                  orderIndex: {
                    gte: boundedTargetOrderIndex,
                    lt: oldOrderIndex,
                  },
                },
                data: {
                  orderIndex: {
                    increment: 1,
                  },
                },
              });
            }
          } else {
            await tx.task.updateMany({
              where: {
                columnId: oldColumnId,
                orderIndex: {
                  gt: oldOrderIndex,
                },
              },
              data: {
                orderIndex: {
                  decrement: 1,
                },
              },
            });

            await tx.task.updateMany({
              where: {
                columnId: dto.columnId,
                orderIndex: {
                  gte: boundedTargetOrderIndex,
                },
              },
              data: {
                orderIndex: {
                  increment: 1,
                },
              },
            });
          }

          const moved = await tx.task.update({
            where: { id: latest.id },
            data: {
              columnId: dto.columnId,
              orderIndex: boundedTargetOrderIndex,
            },
          });

          await this.recordActivity(tx, {
            workspaceId: latest.project.workspaceId,
            projectId: latest.projectId,
            taskId: latest.id,
            actorUserId: userId,
            action: "TASK_MOVED",
            entityType: "task",
            entityId: latest.id,
            payload: {
              from: {
                columnId: oldColumnId,
                orderIndex: oldOrderIndex,
              },
              to: {
                columnId: dto.columnId,
                orderIndex: boundedTargetOrderIndex,
              },
            },
          });

          return {
            data: moved,
          };
        },
      );
    });

    return result;
  }

  async deleteTask(
    userId: string,
    systemRole: string | undefined,
    taskId: string,
  ) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        project: true,
      },
    });
    if (!task) {
      throw new NotFoundException({
        code: "TASK_NOT_FOUND",
        message: "Task not found",
      });
    }
    const access = await this.requireProjectAccess(
      userId,
      task.projectId,
      "edit",
      systemRole,
    );
    this.assertMemberTaskOwnership(access, userId, task, "delete tasks");
    await this.assertMemberPolicyAllowed(
      access,
      "allowTaskDeleteByMember",
      "Task deletion is disabled for members",
    );

    await this.prisma.$transaction(async (tx) => {
      await this.recordActivity(tx, {
        workspaceId: task.project.workspaceId,
        projectId: task.projectId,
        taskId: task.id,
        actorUserId: userId,
        action: "TASK_DELETED",
        entityType: "task",
        entityId: task.id,
        payload: {
          title: task.title,
          columnId: task.columnId,
          orderIndex: task.orderIndex,
        },
      });

      await tx.task.delete({
        where: {
          id: task.id,
        },
      });

      await tx.task.updateMany({
        where: {
          columnId: task.columnId,
          orderIndex: {
            gt: task.orderIndex,
          },
        },
        data: {
          orderIndex: {
            decrement: 1,
          },
        },
      });
    });

    return { success: true };
  }

  async listComments(
    userId: string,
    taskId: string,
    page?: number,
    limit?: number,
  ) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        project: true,
      },
    });
    if (!task) {
      throw new NotFoundException({
        code: "TASK_NOT_FOUND",
        message: "Task not found",
      });
    }
    await this.requireProjectAccess(userId, task.projectId, "view");

    const pagination = this.resolvePagination(page, limit);
    const total = await this.prisma.taskComment.count({
      where: { taskId },
    });
    const comments = await this.prisma.taskComment.findMany({
      where: { taskId },
      orderBy: { createdAt: "asc" },
      skip: pagination.skip,
      take: pagination.limit,
    });

    return {
      data: comments,
      meta: this.toPaginationMeta(total, pagination.page, pagination.limit),
    };
  }

  async createComment(userId: string, taskId: string, dto: CreateCommentDto) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        project: true,
      },
    });
    if (!task) {
      throw new NotFoundException({
        code: "TASK_NOT_FOUND",
        message: "Task not found",
      });
    }
    const access = await this.requireProjectAccess(userId, task.projectId, "view");
    if (!this.canProjectEdit(access.workspaceRole, access.projectRole)) {
      const settings = await this.ensureProjectSettings(
        access.project.id,
        access.project.defaultView,
      );
      if (!settings.allowViewerComment) {
        throw new ForbiddenException({
          code: "PROJECT_FORBIDDEN",
          message: "Comments are disabled for viewers",
        });
      }
    }

    const comment = await this.prisma.$transaction(async (tx) => {
      const createdComment = await tx.taskComment.create({
        data: {
          taskId,
          authorUserId: userId,
          content: dto.content.trim(),
        },
      });
      await this.recordActivity(tx, {
        workspaceId: task.project.workspaceId,
        projectId: task.projectId,
        taskId: task.id,
        actorUserId: userId,
        action: "COMMENT_CREATED",
        entityType: "comment",
        entityId: createdComment.id,
        payload: {
          taskId,
        },
      });
      return createdComment;
    });

    const recipients = await this.resolveCommentNotificationRecipients(
      task.projectId,
      task.assigneeUserId,
      userId,
    );
    if (recipients.length > 0) {
      await this.pushNotifications(
        recipients.map((recipientUserId) => ({
          recipientUserId,
          actorUserId: userId,
          workspaceId: task.project.workspaceId,
          projectId: task.projectId,
          taskId: task.id,
          type: NotificationType.COMMENT_ADDED,
          title: "New comment",
          body: `A new comment was added to ${task.title}.`,
          payload: {
            commentId: comment.id,
          },
        })),
      );
    }

    return {
      data: comment,
    };
  }

  async archiveProject(
    userId: string,
    systemRole: string | undefined,
    projectId: string,
  ) {
    const { project } = await this.requireProjectAccess(
      userId,
      projectId,
      "admin",
      systemRole,
    );
    if (project.status === ProjectStatus.ARCHIVED && project.archivedAt) {
      return { data: project };
    }

    const archived = await this.prisma.project.update({
      where: { id: projectId },
      data: {
        status: ProjectStatus.ARCHIVED,
        archivedAt: new Date(),
        updatedByUserId: userId,
      },
    });

    await this.recordActivity(this.prisma, {
      workspaceId: archived.workspaceId,
      projectId: archived.id,
      actorUserId: userId,
      action: "PROJECT_ARCHIVED",
      entityType: "project",
      entityId: archived.id,
      payload: {
        name: archived.name,
      },
    });

    const recipients = await this.prisma.projectMember.findMany({
      where: {
        projectId: archived.id,
        status: MembershipStatus.ACTIVE,
        userId: { not: userId },
      },
      select: { userId: true },
    });
    await this.pushNotifications(
      recipients.map((item) => ({
        recipientUserId: item.userId,
        actorUserId: userId,
        workspaceId: archived.workspaceId,
        projectId: archived.id,
        type: NotificationType.PROJECT_ARCHIVED,
        title: "Project archived",
        body: `${archived.name} was archived.`,
      })),
    );

    return { data: archived };
  }

  async restoreProject(
    userId: string,
    systemRole: string | undefined,
    projectId: string,
  ) {
    const { project } = await this.requireProjectAccess(
      userId,
      projectId,
      "admin",
      systemRole,
    );

    const restored = await this.prisma.project.update({
      where: { id: projectId },
      data: {
        status: ProjectStatus.ACTIVE,
        archivedAt: null,
        updatedByUserId: userId,
      },
    });

    await this.recordActivity(this.prisma, {
      workspaceId: restored.workspaceId,
      projectId: restored.id,
      actorUserId: userId,
      action: "PROJECT_RESTORED",
      entityType: "project",
      entityId: restored.id,
      payload: {
        previousStatus: project.status,
      },
    });

    return { data: restored };
  }

  async listNotifications(
    userId: string,
    page?: number,
    limit?: number,
    unreadOnly?: boolean,
  ) {
    await this.dispatchDueNotificationsIfNeeded();
    const pagination = this.resolvePagination(page, limit);
    const where: Prisma.NotificationWhereInput = {
      recipientUserId: userId,
      ...(unreadOnly ? { isRead: false } : {}),
    };
    const total = await this.prisma.notification.count({ where });
    const notifications = await this.prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: pagination.skip,
      take: pagination.limit,
    });

    return {
      data: notifications,
      meta: this.toPaginationMeta(total, pagination.page, pagination.limit),
    };
  }

  async getNotificationUnreadCount(userId: string) {
    await this.dispatchDueNotificationsIfNeeded();
    const count = await this.prisma.notification.count({
      where: {
        recipientUserId: userId,
        isRead: false,
      },
    });
    return {
      data: {
        unreadCount: count,
      },
    };
  }

  async markNotificationRead(userId: string, notificationId: string) {
    const current = await this.prisma.notification.findFirst({
      where: {
        id: notificationId,
        recipientUserId: userId,
      },
    });
    if (!current) {
      throw new NotFoundException({
        code: "NOTIFICATION_NOT_FOUND",
        message: "Notification not found",
      });
    }

    const updated = await this.prisma.notification.update({
      where: { id: notificationId },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    this.emitNotificationEvent(userId, "notification.read", {
      notificationId: updated.id,
      readAt: updated.readAt,
    });
    await this.emitUnreadCount(userId);

    return { data: updated };
  }

  async markAllNotificationsRead(userId: string) {
    const now = new Date();
    const result = await this.prisma.notification.updateMany({
      where: {
        recipientUserId: userId,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: now,
      },
    });
    this.emitNotificationEvent(userId, "notification.read-all", {
      updated: result.count,
      readAt: now,
    });
    await this.emitUnreadCount(userId);
    return {
      data: {
        updated: result.count,
      },
    };
  }

  openNotificationStream(userId: string, request: Request, response: Response): void {
    response.status(200);
    response.setHeader("content-type", "text/event-stream; charset=utf-8");
    response.setHeader("cache-control", "no-cache, no-transform");
    response.setHeader("connection", "keep-alive");
    response.setHeader("x-accel-buffering", "no");
    response.flushHeaders?.();

    const userStreams = this.notificationStreams.get(userId) ?? new Set<Response>();
    userStreams.add(response);
    this.notificationStreams.set(userId, userStreams);

    this.writeSseEvent(response, "notification.status", {
      status: "connected",
      ts: Date.now(),
    });
    void this.emitUnreadCount(userId);

    const heartbeat = setInterval(() => {
      this.writeSseEvent(response, "ping", { ts: Date.now() });
    }, 20_000);
    this.notificationHeartbeatTimers.set(response, heartbeat);

    request.on("close", () => {
      this.detachNotificationStream(userId, response);
    });
  }

  async listWorkspaceActivities(
    userId: string,
    systemRole: string | undefined,
    workspaceId: string,
    query: ActivityQueryDto,
  ) {
    await this.requireWorkspaceRole(userId, workspaceId, VIEW_ROLES, systemRole);
    const pagination = this.resolvePagination(query.page, query.limit);
    const where = this.buildActivityWhere(
      {
        workspaceId,
      },
      query,
    );
    const total = await this.prisma.activity.count({ where });
    const activities = await this.prisma.activity.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: pagination.skip,
      take: pagination.limit,
    });
    return {
      data: activities,
      meta: this.toPaginationMeta(total, pagination.page, pagination.limit),
    };
  }

  async listProjectActivities(
    userId: string,
    systemRole: string | undefined,
    projectId: string,
    query: ActivityQueryDto,
  ) {
    const { project } = await this.requireProjectAccess(
      userId,
      projectId,
      "view",
      systemRole,
    );
    const pagination = this.resolvePagination(query.page, query.limit);
    const where = this.buildActivityWhere(
      {
        workspaceId: project.workspaceId,
        projectId,
      },
      query,
    );
    const total = await this.prisma.activity.count({ where });
    const activities = await this.prisma.activity.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: pagination.skip,
      take: pagination.limit,
    });
    return {
      data: activities,
      meta: this.toPaginationMeta(total, pagination.page, pagination.limit),
    };
  }

  async searchWorkspace(
    userId: string,
    systemRole: string | undefined,
    workspaceId: string,
    query: SearchQueryDto,
  ) {
    await this.requireWorkspaceRole(userId, workspaceId, VIEW_ROLES, systemRole);
    const q = query.q.trim();
    if (!q) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Search query is required",
      });
    }

    const types = new Set(
      String(query.types || "project,task,member,label")
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.length > 0),
    );
    const limit = Number.isInteger(query.limit) && (query.limit ?? 0) > 0
      ? Math.min(query.limit as number, 100)
      : 25;

    const [projects, tasks, members, labels] = await Promise.all([
      types.has("project")
        ? this.prisma.project.findMany({
            where: {
              workspaceId,
              name: { contains: q, mode: "insensitive" },
            },
            orderBy: { createdAt: "desc" },
            take: limit,
          })
        : Promise.resolve([]),
      types.has("task")
        ? this.prisma.task.findMany({
            where: {
              project: { workspaceId },
              title: { contains: q, mode: "insensitive" },
              ...(query.projectId ? { projectId: query.projectId } : {}),
              ...(query.assigneeUserId
                ? { assigneeUserId: query.assigneeUserId }
                : {}),
              ...(query.status ? { status: query.status } : {}),
              archivedAt: null,
            },
            orderBy: { createdAt: "desc" },
            take: limit,
          })
        : Promise.resolve([]),
      types.has("member")
        ? this.prisma.workspaceMember.findMany({
            where: {
              workspaceId,
              status: MembershipStatus.ACTIVE,
            },
            orderBy: { joinedAt: "desc" },
            take: limit,
          })
        : Promise.resolve([]),
      types.has("label")
        ? this.prisma.label.findMany({
            where: {
              workspaceId,
              name: { contains: q, mode: "insensitive" },
            },
            orderBy: { name: "asc" },
            take: limit,
          })
        : Promise.resolve([]),
    ]);

    return {
      data: {
        projects,
        tasks,
        members,
        labels,
      },
    };
  }

  async listSavedViews(
    userId: string,
    systemRole: string | undefined,
    workspaceId: string,
  ) {
    await this.requireWorkspaceRole(userId, workspaceId, VIEW_ROLES, systemRole);
    const views = await this.prisma.savedView.findMany({
      where: {
        workspaceId,
        ownerUserId: userId,
      },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });
    return { data: views };
  }

  async createSavedView(
    userId: string,
    systemRole: string | undefined,
    workspaceId: string,
    dto: CreateSavedViewDto,
  ) {
    await this.requireWorkspaceRole(userId, workspaceId, VIEW_ROLES, systemRole);
    if (dto.isDefault) {
      await this.prisma.savedView.updateMany({
        where: {
          workspaceId,
          ownerUserId: userId,
          isDefault: true,
        },
        data: {
          isDefault: false,
        },
      });
    }

    const created = await this.prisma.savedView.create({
      data: {
        workspaceId,
        ownerUserId: userId,
        name: dto.name.trim(),
        viewType: dto.viewType ?? SavedViewType.BOARD,
        filters: (dto.filters ?? null) as Prisma.InputJsonValue,
        sort: (dto.sort ?? null) as Prisma.InputJsonValue,
        isDefault: dto.isDefault ?? false,
      },
    });
    return { data: created };
  }

  async updateSavedView(
    userId: string,
    systemRole: string | undefined,
    savedViewId: string,
    dto: UpdateSavedViewDto,
  ) {
    const existing = await this.prisma.savedView.findUnique({
      where: { id: savedViewId },
    });
    if (!existing) {
      throw new NotFoundException({
        code: "SAVED_VIEW_NOT_FOUND",
        message: "Saved view not found",
      });
    }
    if (existing.ownerUserId !== userId) {
      await this.requireWorkspaceRole(
        userId,
        existing.workspaceId,
        ADMIN_ROLES,
        systemRole,
      );
    }

    if (dto.isDefault) {
      await this.prisma.savedView.updateMany({
        where: {
          workspaceId: existing.workspaceId,
          ownerUserId: existing.ownerUserId,
          isDefault: true,
        },
        data: {
          isDefault: false,
        },
      });
    }

    const updated = await this.prisma.savedView.update({
      where: { id: savedViewId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.viewType !== undefined ? { viewType: dto.viewType } : {}),
        ...(dto.filters !== undefined
          ? { filters: (dto.filters ?? null) as Prisma.InputJsonValue }
          : {}),
        ...(dto.sort !== undefined
          ? { sort: (dto.sort ?? null) as Prisma.InputJsonValue }
          : {}),
        ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
      },
    });
    return { data: updated };
  }

  async deleteSavedView(
    userId: string,
    systemRole: string | undefined,
    savedViewId: string,
  ) {
    const existing = await this.prisma.savedView.findUnique({
      where: { id: savedViewId },
    });
    if (!existing) {
      throw new NotFoundException({
        code: "SAVED_VIEW_NOT_FOUND",
        message: "Saved view not found",
      });
    }
    if (existing.ownerUserId !== userId) {
      await this.requireWorkspaceRole(
        userId,
        existing.workspaceId,
        ADMIN_ROLES,
        systemRole,
      );
    }
    await this.prisma.savedView.delete({
      where: { id: savedViewId },
    });
    return { success: true };
  }

  async listProjectTemplates(
    userId: string,
    systemRole: string | undefined,
    workspaceId: string,
  ) {
    await this.requireWorkspaceRole(userId, workspaceId, VIEW_ROLES, systemRole);
    const templates = await this.prisma.projectTemplate.findMany({
      where: { workspaceId },
      include: {
        columns: { orderBy: { position: "asc" } },
        labels: { orderBy: { createdAt: "asc" } },
        settings: true,
      },
      orderBy: { createdAt: "desc" },
    });
    return { data: templates };
  }

  async createProjectTemplate(
    userId: string,
    systemRole: string | undefined,
    workspaceId: string,
    dto: CreateTemplateDto,
  ) {
    await this.requireWorkspaceRole(userId, workspaceId, ADMIN_ROLES, systemRole);
    const template = await this.prisma.$transaction(async (tx) => {
      const created = await tx.projectTemplate.create({
        data: {
          workspaceId,
          createdByUserId: userId,
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
        },
      });

      const columns =
        Array.isArray(dto.columns) && dto.columns.length > 0
          ? dto.columns
          : [{ name: "Todo" }, { name: "In Progress" }, { name: "Done" }];
      await tx.projectTemplateColumn.createMany({
        data: columns.map((column, index) => ({
          templateId: created.id,
          name: column.name.trim(),
          position: index,
        })),
      });

      if (Array.isArray(dto.labels) && dto.labels.length > 0) {
        await tx.projectTemplateLabel.createMany({
          data: dto.labels.map((label) => ({
            templateId: created.id,
            name: label.name.trim(),
            color: label.color.trim(),
          })),
        });
      }

      await tx.projectTemplateSetting.create({
        data: this.resolveTemplateSettingCreateData(created.id, dto.settings),
      });

      return tx.projectTemplate.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          columns: { orderBy: { position: "asc" } },
          labels: true,
          settings: true,
        },
      });
    });

    return { data: template };
  }

  async updateProjectTemplate(
    userId: string,
    systemRole: string | undefined,
    templateId: string,
    dto: UpdateTemplateDto,
  ) {
    const existing = await this.prisma.projectTemplate.findUnique({
      where: { id: templateId },
    });
    if (!existing) {
      throw new NotFoundException({
        code: "TEMPLATE_NOT_FOUND",
        message: "Template not found",
      });
    }
    await this.requireWorkspaceRole(
      userId,
      existing.workspaceId,
      ADMIN_ROLES,
      systemRole,
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.projectTemplate.update({
        where: { id: templateId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.description !== undefined
            ? { description: dto.description.trim() || null }
            : {}),
        },
      });

      if (Array.isArray(dto.columns)) {
        await tx.projectTemplateColumn.deleteMany({ where: { templateId } });
        await tx.projectTemplateColumn.createMany({
          data: dto.columns.map((column, index) => ({
            templateId,
            name: column.name.trim(),
            position: index,
          })),
        });
      }

      if (Array.isArray(dto.labels)) {
        await tx.projectTemplateLabel.deleteMany({ where: { templateId } });
        await tx.projectTemplateLabel.createMany({
          data: dto.labels.map((label) => ({
            templateId,
            name: label.name.trim(),
            color: label.color.trim(),
          })),
        });
      }

      if (dto.settings !== undefined) {
        await tx.projectTemplateSetting.upsert({
          where: { templateId },
          create: this.resolveTemplateSettingCreateData(templateId, dto.settings),
          update: this.resolveTemplateSettingUpdateData(dto.settings),
        });
      }

      return tx.projectTemplate.findUniqueOrThrow({
        where: { id: templateId },
        include: {
          columns: { orderBy: { position: "asc" } },
          labels: true,
          settings: true,
        },
      });
    });

    return { data: updated };
  }

  async deleteProjectTemplate(
    userId: string,
    systemRole: string | undefined,
    templateId: string,
  ) {
    const existing = await this.prisma.projectTemplate.findUnique({
      where: { id: templateId },
    });
    if (!existing) {
      throw new NotFoundException({
        code: "TEMPLATE_NOT_FOUND",
        message: "Template not found",
      });
    }
    await this.requireWorkspaceRole(
      userId,
      existing.workspaceId,
      ADMIN_ROLES,
      systemRole,
    );
    await this.prisma.projectTemplate.delete({
      where: { id: templateId },
    });
    return { success: true };
  }

  async createProjectFromTemplate(
    userId: string,
    systemRole: string | undefined,
    workspaceId: string,
    templateId: string,
    dto: CreateProjectFromTemplateDto,
  ) {
    await this.requireWorkspaceRole(userId, workspaceId, EDIT_ROLES, systemRole);
    const template = await this.prisma.projectTemplate.findFirst({
      where: {
        id: templateId,
        workspaceId,
      },
      include: {
        columns: { orderBy: { position: "asc" } },
        labels: true,
        settings: true,
      },
    });
    if (!template) {
      throw new NotFoundException({
        code: "TEMPLATE_NOT_FOUND",
        message: "Template not found",
      });
    }

    const project = await this.prisma.$transaction(async (tx) => {
      const createdProject = await tx.project.create({
        data: {
          workspaceId,
          ownerUserId: userId,
          name: dto.name.trim(),
          description: dto.description?.trim() || template.description || null,
          visibility: ProjectVisibility.PRIVATE,
          defaultView: template.settings?.defaultView ?? ProjectViewType.BOARD,
          createdByUserId: userId,
          updatedByUserId: userId,
          status: ProjectStatus.ACTIVE,
        },
      });

      await tx.projectMember.create({
        data: {
          projectId: createdProject.id,
          userId,
          role: WorkspaceRole.OWNER,
          status: MembershipStatus.ACTIVE,
        },
      });

      const columns: Array<{ name: string; position: number }> =
        template.columns.length > 0
          ? template.columns.map((column) => ({
              name: column.name,
              position: column.position,
            }))
          : [
              { name: "Todo", position: 0 },
              { name: "In Progress", position: 1 },
              { name: "Done", position: 2 },
            ];
      await tx.taskColumn.createMany({
        data: columns.map((column, index: number) => ({
          projectId: createdProject.id,
          name: column.name,
          position: Number.isFinite(column.position) ? column.position : index,
        })),
      });

      if (template.settings) {
        await tx.projectSetting.create({
          data: {
            projectId: createdProject.id,
            defaultView: template.settings.defaultView,
            allowMemberInvite: template.settings.allowMemberInvite,
            allowComment: template.settings.allowComment,
            allowViewerComment: template.settings.allowViewerComment,
            allowTaskReorder: template.settings.allowTaskReorder,
            allowTaskDeleteByMember: template.settings.allowTaskDeleteByMember,
            taskPrefix: template.settings.taskPrefix,
            themeColor: template.settings.themeColor,
            isPrivateByDefault: template.settings.isPrivateByDefault,
          },
        });
      } else {
        await tx.projectSetting.create({
          data: {
            projectId: createdProject.id,
            defaultView: ProjectViewType.BOARD,
          },
        });
      }

      if (template.labels.length > 0) {
        for (const label of template.labels) {
          await tx.label.upsert({
            where: {
              workspaceId_name: {
                workspaceId,
                name: label.name,
              },
            },
            update: {
              color: label.color,
            },
            create: {
              workspaceId,
              name: label.name,
              color: label.color,
            },
          });
        }
      }

      await this.recordActivity(tx, {
        workspaceId,
        projectId: createdProject.id,
        actorUserId: userId,
        action: "PROJECT_CREATED_FROM_TEMPLATE",
        entityType: "project",
        entityId: createdProject.id,
        payload: {
          templateId: template.id,
          templateName: template.name,
        },
      });

      return createdProject;
    });

    return { data: project };
  }

  async getReportOverview(
    userId: string,
    systemRole: string | undefined,
    workspaceId: string,
    query: ReportOverviewQueryDto,
  ) {
    await this.requireWorkspaceRole(userId, workspaceId, ADMIN_ROLES, systemRole);
    const range = this.resolveReportRange(query.from, query.to);
    const [createdCount, completedCount, overdueCount, totalTaskCount] = await Promise.all([
      this.prisma.task.count({
        where: {
          project: { workspaceId },
          createdAt: {
            gte: range.from,
            lte: range.to,
          },
        },
      }),
      this.prisma.task.count({
        where: {
          project: { workspaceId },
          completedAt: {
            gte: range.from,
            lte: range.to,
          },
        },
      }),
      this.prisma.task.count({
        where: {
          project: { workspaceId },
          archivedAt: null,
          dueAt: {
            lt: new Date(),
          },
          status: {
            not: TaskStatus.DONE,
          },
        },
      }),
      this.prisma.task.count({
        where: {
          project: { workspaceId },
        },
      }),
    ]);

    const groupBy = query.groupBy ?? ReportGroupBy.DAY;
    const unit = groupBy === ReportGroupBy.WEEK ? "week" : "day";
    const series = await this.prisma.$queryRaw<
      Array<{ bucket: Date; created_count: bigint; completed_count: bigint }>
    >(
      Prisma.sql`
        SELECT
          date_trunc(${unit}, t.created_at) AS bucket,
          COUNT(*)::bigint AS created_count,
          SUM(CASE WHEN t.completed_at IS NOT NULL THEN 1 ELSE 0 END)::bigint AS completed_count
        FROM task.tasks t
        INNER JOIN task.projects p ON p.id = t.project_id
        WHERE p.workspace_id = ${workspaceId}::uuid
          AND t.created_at BETWEEN ${range.from}::timestamptz AND ${range.to}::timestamptz
        GROUP BY bucket
        ORDER BY bucket ASC
      `,
    );

    return {
      data: {
        from: range.from,
        to: range.to,
        groupBy,
        metrics: {
          createdCount,
          completedCount,
          overdueCount,
          totalTaskCount,
        },
        series: series.map((row) => ({
          bucket: row.bucket,
          createdCount: Number(row.created_count),
          completedCount: Number(row.completed_count),
        })),
      },
    };
  }

  async getReportBreakdown(
    userId: string,
    systemRole: string | undefined,
    workspaceId: string,
    query: ReportBreakdownQueryDto,
  ) {
    await this.requireWorkspaceRole(userId, workspaceId, ADMIN_ROLES, systemRole);
    const range = this.resolveReportRange(query.from, query.to);

    if (query.dimension === ReportBreakdownDimension.PROJECT) {
      const rows = await this.prisma.$queryRaw<
        Array<{ project_id: string; project_name: string; task_count: bigint }>
      >(
        Prisma.sql`
          SELECT
            p.id AS project_id,
            p.name AS project_name,
            COUNT(t.id)::bigint AS task_count
          FROM task.projects p
          LEFT JOIN task.tasks t ON t.project_id = p.id
            AND t.created_at BETWEEN ${range.from}::timestamptz AND ${range.to}::timestamptz
          WHERE p.workspace_id = ${workspaceId}::uuid
          GROUP BY p.id, p.name
          ORDER BY task_count DESC, p.name ASC
        `,
      );
      return { data: rows };
    }

    if (query.dimension === ReportBreakdownDimension.ASSIGNEE) {
      const rows = await this.prisma.$queryRaw<
        Array<{ assignee_user_id: string | null; task_count: bigint }>
      >(
        Prisma.sql`
          SELECT
            t.assignee_user_id,
            COUNT(t.id)::bigint AS task_count
          FROM task.tasks t
          INNER JOIN task.projects p ON p.id = t.project_id
          WHERE p.workspace_id = ${workspaceId}::uuid
            AND t.created_at BETWEEN ${range.from}::timestamptz AND ${range.to}::timestamptz
          GROUP BY t.assignee_user_id
          ORDER BY task_count DESC
        `,
      );
      return { data: rows };
    }

    if (query.dimension === ReportBreakdownDimension.STATUS) {
      const rows = await this.prisma.$queryRaw<
        Array<{ status: string; task_count: bigint }>
      >(
        Prisma.sql`
          SELECT
            t.status::text AS status,
            COUNT(t.id)::bigint AS task_count
          FROM task.tasks t
          INNER JOIN task.projects p ON p.id = t.project_id
          WHERE p.workspace_id = ${workspaceId}::uuid
            AND t.created_at BETWEEN ${range.from}::timestamptz AND ${range.to}::timestamptz
          GROUP BY t.status
          ORDER BY task_count DESC
        `,
      );
      return { data: rows };
    }

    const rows = await this.prisma.$queryRaw<
      Array<{ label_name: string; task_count: bigint }>
    >(
      Prisma.sql`
        SELECT
          l.name AS label_name,
          COUNT(tl.task_id)::bigint AS task_count
        FROM task.labels l
        INNER JOIN task.task_labels tl ON tl.label_id = l.id
        INNER JOIN task.tasks t ON t.id = tl.task_id
        INNER JOIN task.projects p ON p.id = t.project_id
        WHERE p.workspace_id = ${workspaceId}::uuid
          AND t.created_at BETWEEN ${range.from}::timestamptz AND ${range.to}::timestamptz
        GROUP BY l.name
        ORDER BY task_count DESC, l.name ASC
      `,
    );
    return { data: rows };
  }

  async exportReportCsv(
    userId: string,
    systemRole: string | undefined,
    workspaceId: string,
    query: ReportExportQueryDto,
  ): Promise<{ filename: string; csv: string }> {
    await this.requireWorkspaceRole(userId, workspaceId, ADMIN_ROLES, systemRole);
    const range = this.resolveReportRange(query.from, query.to);
    const type = query.type ?? ReportExportType.SUMMARY;
    const safeType = String(type).toLowerCase();
    const filename = `workspace-${workspaceId}-${safeType}-report.csv`;

    if (type === ReportExportType.TASKS) {
      const rows = await this.prisma.task.findMany({
        where: {
          project: { workspaceId },
          createdAt: {
            gte: range.from,
            lte: range.to,
          },
        },
        include: {
          project: {
            select: {
              name: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 5000,
      });
      const csv = this.toCsv(
        ["taskId", "projectName", "title", "status", "priority", "assigneeUserId", "createdAt", "completedAt", "dueAt"],
        rows.map((row) => [
          row.id,
          row.project.name,
          row.title,
          row.status,
          row.priority,
          row.assigneeUserId ?? "",
          row.createdAt.toISOString(),
          row.completedAt ? row.completedAt.toISOString() : "",
          row.dueAt ? row.dueAt.toISOString() : "",
        ]),
      );
      return { filename, csv };
    }

    if (type === ReportExportType.ACTIVITY) {
      const rows = await this.prisma.activity.findMany({
        where: {
          workspaceId,
          createdAt: {
            gte: range.from,
            lte: range.to,
          },
        },
        orderBy: { createdAt: "desc" },
        take: 10000,
      });
      const csv = this.toCsv(
        ["activityId", "actorUserId", "action", "entityType", "entityId", "projectId", "taskId", "createdAt"],
        rows.map((row) => [
          row.id,
          row.actorUserId,
          row.action,
          row.entityType,
          row.entityId,
          row.projectId ?? "",
          row.taskId ?? "",
          row.createdAt.toISOString(),
        ]),
      );
      return { filename, csv };
    }

    const overview = await this.getReportOverview(userId, systemRole, workspaceId, {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      groupBy: ReportGroupBy.DAY,
    });
    const metrics = overview.data.metrics;
    const csv = this.toCsv(
      ["metric", "value"],
      [
        ["createdCount", metrics.createdCount],
        ["completedCount", metrics.completedCount],
        ["overdueCount", metrics.overdueCount],
        ["totalTaskCount", metrics.totalTaskCount],
      ],
    );
    return { filename, csv };
  }

  private async resolveTargetColumnIdForCreate(
    tx: PrismaTx,
    projectId: string,
    columnId?: string,
  ): Promise<string> {
    if (columnId) {
      const existing = await tx.taskColumn.findFirst({
        where: {
          id: columnId,
          projectId,
        },
      });
      if (!existing) {
        throw new BadRequestException({
          code: "COLUMN_NOT_FOUND",
          message: "Target column not found in project",
        });
      }
      return existing.id;
    }

    const firstColumn = await tx.taskColumn.findFirst({
      where: {
        projectId,
      },
      orderBy: {
        position: "asc",
      },
    });

    if (!firstColumn) {
      throw new BadRequestException({
        code: "COLUMN_NOT_FOUND",
        message: "Project has no columns",
      });
    }
    return firstColumn.id;
  }

  private canProjectEdit(
    workspaceRole: WorkspaceRole,
    projectRole: WorkspaceRole | null,
  ): boolean {
    if (ADMIN_ROLES.includes(workspaceRole)) {
      return true;
    }
    return !!projectRole && EDIT_ROLES.includes(projectRole);
  }

  private canProjectAdmin(
    workspaceRole: WorkspaceRole,
    projectRole: WorkspaceRole | null,
  ): boolean {
    if (ADMIN_ROLES.includes(workspaceRole)) {
      return true;
    }
    return (
      projectRole === WorkspaceRole.OWNER || projectRole === WorkspaceRole.ADMIN
    );
  }

  private isMemberLevelEditor(
    workspaceRole: WorkspaceRole,
    projectRole: WorkspaceRole | null,
  ): boolean {
    if (ADMIN_ROLES.includes(workspaceRole)) {
      return false;
    }
    return projectRole === WorkspaceRole.MEMBER;
  }

  private assertMemberCreateOwnership(
    access: {
      workspaceRole: WorkspaceRole;
      projectRole: WorkspaceRole | null;
    },
    userId: string,
    assigneeUserId: string | undefined,
  ): void {
    if (!this.isMemberLevelEditor(access.workspaceRole, access.projectRole)) {
      return;
    }
    if (!assigneeUserId || assigneeUserId !== userId) {
      throw new ForbiddenException({
        code: "TASK_OWNERSHIP_FORBIDDEN",
        message: "Members can only create tasks assigned to themselves",
      });
    }
  }

  private assertMemberTaskOwnership(
    access: {
      workspaceRole: WorkspaceRole;
      projectRole: WorkspaceRole | null;
    },
    userId: string,
    task: {
      id: string;
      assigneeUserId: string | null;
    },
    actionLabel: string,
  ): void {
    if (!this.isMemberLevelEditor(access.workspaceRole, access.projectRole)) {
      return;
    }
    if (!task.assigneeUserId || task.assigneeUserId !== userId) {
      throw new ForbiddenException({
        code: "TASK_OWNERSHIP_FORBIDDEN",
        message: `Members can only ${actionLabel} assigned to themselves`,
      });
    }
  }

  private assertMemberAssigneeChange(
    access: {
      workspaceRole: WorkspaceRole;
      projectRole: WorkspaceRole | null;
    },
    userId: string,
    assigneeUserId: string | null | undefined,
  ): void {
    if (!this.isMemberLevelEditor(access.workspaceRole, access.projectRole)) {
      return;
    }
    if (assigneeUserId !== undefined && assigneeUserId !== userId) {
      throw new ForbiddenException({
        code: "TASK_OWNERSHIP_FORBIDDEN",
        message: "Members cannot assign tasks to other users",
      });
    }
  }

  private async ensureProjectSettings(
    projectId: string,
    defaultView: ProjectViewType,
  ) {
    return this.prisma.projectSetting.upsert({
      where: { projectId },
      create: {
        projectId,
        defaultView,
      },
      update: {},
    });
  }

  private async assertMemberPolicyAllowed(
    access: {
      project: {
        id: string;
        defaultView: ProjectViewType;
      };
      workspaceRole: WorkspaceRole;
      projectRole: WorkspaceRole | null;
    },
    policy:
      | "allowTaskReorder"
      | "allowTaskDeleteByMember",
    message: string,
  ): Promise<void> {
    if (!this.isMemberLevelEditor(access.workspaceRole, access.projectRole)) {
      return;
    }

    const settings = await this.ensureProjectSettings(
      access.project.id,
      access.project.defaultView,
    );
    if (!settings[policy]) {
      throw new ForbiddenException({
        code: "PROJECT_FORBIDDEN",
        message,
      });
    }
  }

  private async nextOrderIndex(
    tx: PrismaTx,
    columnId: string,
  ): Promise<number> {
    const latest = await tx.task.findFirst({
      where: {
        columnId,
      },
      orderBy: {
        orderIndex: "desc",
      },
      select: {
        orderIndex: true,
      },
    });
    return (latest?.orderIndex ?? -1) + 1;
  }

  private buildBoardTaskWhere(
    projectId: string,
    query: BoardQueryDto,
  ): Prisma.TaskWhereInput {
    const where: Prisma.TaskWhereInput = {
      projectId,
      archivedAt: null,
    };

    if (query.status) {
      where.status = query.status;
    }
    if (query.assigneeUserId) {
      where.assigneeUserId = query.assigneeUserId;
    }
    if (query.dueFrom || query.dueTo) {
      where.dueAt = {
        ...(query.dueFrom ? { gte: new Date(query.dueFrom) } : {}),
        ...(query.dueTo ? { lte: new Date(query.dueTo) } : {}),
      };
    }
    if (query.q) {
      const q = query.q.trim();
      if (q.length > 0) {
        where.OR = [
          {
            title: {
              contains: q,
              mode: "insensitive",
            },
          },
          {
            description: {
              contains: q,
              mode: "insensitive",
            },
          },
        ];
      }
    }

    return where;
  }

  private buildProjectListWhere(
    workspaceId: string,
    userId: string,
    workspaceRole: WorkspaceRole,
  ): Prisma.ProjectWhereInput {
    if (ADMIN_ROLES.includes(workspaceRole)) {
      return { workspaceId };
    }

    return {
      workspaceId,
      OR: [
        { visibility: ProjectVisibility.WORKSPACE },
        {
          members: {
            some: {
              userId,
              status: MembershipStatus.ACTIVE,
            },
          },
        },
      ],
    };
  }

  private async pushNotification(input: {
    recipientUserId: string;
    actorUserId?: string | null;
    workspaceId?: string | null;
    projectId?: string | null;
    taskId?: string | null;
    type: NotificationType;
    title: string;
    body?: string | null;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    if (!input.recipientUserId) {
      return;
    }

    if (
      input.actorUserId &&
      input.actorUserId.length > 0 &&
      input.actorUserId === input.recipientUserId
    ) {
      return;
    }

    const created = await this.prisma.notification.create({
      data: {
        recipientUserId: input.recipientUserId,
        actorUserId: input.actorUserId ?? null,
        workspaceId: input.workspaceId ?? null,
        projectId: input.projectId ?? null,
        taskId: input.taskId ?? null,
        type: input.type,
        title: input.title.trim(),
        body: input.body?.trim() || null,
        payload: (input.payload ?? null) as Prisma.InputJsonValue,
      },
    });

    this.emitNotificationEvent(input.recipientUserId, "notification.created", created);
    await this.emitUnreadCount(input.recipientUserId);
  }

  private async pushNotifications(
    inputs: Array<{
      recipientUserId: string;
      actorUserId?: string | null;
      workspaceId?: string | null;
      projectId?: string | null;
      taskId?: string | null;
      type: NotificationType;
      title: string;
      body?: string | null;
      payload?: Record<string, unknown>;
    }>,
  ): Promise<void> {
    for (const input of inputs) {
      await this.pushNotification(input);
    }
  }

  private emitNotificationEvent(
    userId: string,
    event: string,
    payload: unknown,
  ): void {
    const streams = this.notificationStreams.get(userId);
    if (!streams || streams.size === 0) {
      return;
    }

    for (const stream of streams) {
      try {
        this.writeSseEvent(stream, event, payload);
      } catch {
        this.detachNotificationStream(userId, stream);
      }
    }
  }

  private async emitUnreadCount(userId: string): Promise<void> {
    const unreadCount = await this.prisma.notification.count({
      where: {
        recipientUserId: userId,
        isRead: false,
      },
    });
    this.emitNotificationEvent(userId, "notification.unread-count", {
      unreadCount,
    });
  }

  private writeSseEvent(response: Response, event: string, payload: unknown): void {
    response.write(`event: ${event}\n`);
    response.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  private detachNotificationStream(userId: string, response: Response): void {
    const timer = this.notificationHeartbeatTimers.get(response);
    if (timer) {
      clearInterval(timer);
      this.notificationHeartbeatTimers.delete(response);
    }

    const streams = this.notificationStreams.get(userId);
    if (!streams) {
      return;
    }
    streams.delete(response);
    if (streams.size === 0) {
      this.notificationStreams.delete(userId);
    }
  }

  private async resolveCommentNotificationRecipients(
    projectId: string,
    assigneeUserId: string | null,
    actorUserId: string,
  ): Promise<string[]> {
    const memberRows = await this.prisma.projectMember.findMany({
      where: {
        projectId,
        status: MembershipStatus.ACTIVE,
      },
      select: {
        userId: true,
      },
    });

    const recipientSet = new Set(memberRows.map((item) => item.userId));
    if (assigneeUserId) {
      recipientSet.add(assigneeUserId);
    }
    recipientSet.delete(actorUserId);
    return Array.from(recipientSet);
  }

  private async dispatchDueNotificationsIfNeeded(): Promise<void> {
    const nowMs = Date.now();
    if (nowMs - this.lastDueNotificationSweepAt < this.dueNotificationSweepWindowMs) {
      return;
    }
    this.lastDueNotificationSweepAt = nowMs;

    const now = new Date(nowMs);
    const soonBoundary = new Date(nowMs + 24 * 60 * 60 * 1000);
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);

    const [dueSoonTasks, overdueTasks] = await Promise.all([
      this.prisma.task.findMany({
        where: {
          archivedAt: null,
          assigneeUserId: { not: null },
          status: { not: TaskStatus.DONE },
          dueAt: {
            gte: now,
            lte: soonBoundary,
          },
          project: {
            status: ProjectStatus.ACTIVE,
          },
        },
        include: {
          project: {
            select: {
              workspaceId: true,
              name: true,
            },
          },
        },
        take: 300,
      }),
      this.prisma.task.findMany({
        where: {
          archivedAt: null,
          assigneeUserId: { not: null },
          status: { not: TaskStatus.DONE },
          dueAt: {
            lt: now,
          },
          project: {
            status: ProjectStatus.ACTIVE,
          },
        },
        include: {
          project: {
            select: {
              workspaceId: true,
              name: true,
            },
          },
        },
        take: 300,
      }),
    ]);

    for (const task of dueSoonTasks) {
      if (!task.assigneeUserId || !task.dueAt) {
        continue;
      }
      const existed = await this.prisma.notification.findFirst({
        where: {
          recipientUserId: task.assigneeUserId,
          taskId: task.id,
          type: NotificationType.TASK_DUE_SOON,
          createdAt: {
            gte: dayStart,
          },
        },
      });
      if (existed) {
        continue;
      }
      await this.pushNotification({
        recipientUserId: task.assigneeUserId,
        workspaceId: task.project.workspaceId,
        projectId: task.projectId,
        taskId: task.id,
        type: NotificationType.TASK_DUE_SOON,
        title: "Task due soon",
        body: `${task.title} is due on ${task.dueAt.toISOString()}.`,
      });
    }

    for (const task of overdueTasks) {
      if (!task.assigneeUserId || !task.dueAt) {
        continue;
      }
      const existed = await this.prisma.notification.findFirst({
        where: {
          recipientUserId: task.assigneeUserId,
          taskId: task.id,
          type: NotificationType.TASK_OVERDUE,
          createdAt: {
            gte: dayStart,
          },
        },
      });
      if (existed) {
        continue;
      }
      await this.pushNotification({
        recipientUserId: task.assigneeUserId,
        workspaceId: task.project.workspaceId,
        projectId: task.projectId,
        taskId: task.id,
        type: NotificationType.TASK_OVERDUE,
        title: "Task overdue",
        body: `${task.title} is overdue.`,
      });
    }
  }

  private buildActivityWhere(
    scope: {
      workspaceId: string;
      projectId?: string;
    },
    query: ActivityQueryDto,
  ): Prisma.ActivityWhereInput {
    const where: Prisma.ActivityWhereInput = {
      workspaceId: scope.workspaceId,
      ...(scope.projectId ? { projectId: scope.projectId } : {}),
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(query.action ? { action: query.action.trim() } : {}),
      ...(query.entityType ? { entityType: query.entityType.trim() } : {}),
    };

    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    return where;
  }

  private resolveTemplateSettingCreateData(
    templateId: string,
    settings?: Record<string, unknown>,
  ): Prisma.ProjectTemplateSettingUncheckedCreateInput {
    const source = settings ?? {};
    const defaultView =
      typeof source.defaultView === "string" &&
      Object.values(ProjectViewType).includes(source.defaultView as ProjectViewType)
        ? (source.defaultView as ProjectViewType)
        : ProjectViewType.BOARD;
    const taskPrefix =
      typeof source.taskPrefix === "string" && source.taskPrefix.trim().length > 0
        ? source.taskPrefix.trim().slice(0, 20)
        : null;
    const themeColor =
      typeof source.themeColor === "string" && source.themeColor.trim().length > 0
        ? source.themeColor.trim().slice(0, 32)
        : null;

    return {
      templateId,
      defaultView,
      allowMemberInvite:
        typeof source.allowMemberInvite === "boolean"
          ? source.allowMemberInvite
          : false,
      allowComment:
        typeof source.allowComment === "boolean" ? source.allowComment : true,
      allowViewerComment:
        typeof source.allowViewerComment === "boolean"
          ? source.allowViewerComment
          : false,
      allowTaskReorder:
        typeof source.allowTaskReorder === "boolean"
          ? source.allowTaskReorder
          : true,
      allowTaskDeleteByMember:
        typeof source.allowTaskDeleteByMember === "boolean"
          ? source.allowTaskDeleteByMember
          : false,
      taskPrefix,
      themeColor,
      isPrivateByDefault:
        typeof source.isPrivateByDefault === "boolean"
          ? source.isPrivateByDefault
          : true,
    };
  }

  private resolveTemplateSettingUpdateData(
    settings?: Record<string, unknown>,
  ): Prisma.ProjectTemplateSettingUncheckedUpdateInput {
    if (!settings) {
      return {};
    }

    const data: Prisma.ProjectTemplateSettingUncheckedUpdateInput = {};
    const rawDefaultView = settings.defaultView;
    if (
      typeof rawDefaultView === "string" &&
      Object.values(ProjectViewType).includes(rawDefaultView as ProjectViewType)
    ) {
      data.defaultView = rawDefaultView as ProjectViewType;
    }
    if (typeof settings.allowMemberInvite === "boolean") {
      data.allowMemberInvite = settings.allowMemberInvite;
    }
    if (typeof settings.allowComment === "boolean") {
      data.allowComment = settings.allowComment;
    }
    if (typeof settings.allowViewerComment === "boolean") {
      data.allowViewerComment = settings.allowViewerComment;
    }
    if (typeof settings.allowTaskReorder === "boolean") {
      data.allowTaskReorder = settings.allowTaskReorder;
    }
    if (typeof settings.allowTaskDeleteByMember === "boolean") {
      data.allowTaskDeleteByMember = settings.allowTaskDeleteByMember;
    }
    if (typeof settings.isPrivateByDefault === "boolean") {
      data.isPrivateByDefault = settings.isPrivateByDefault;
    }
    if (typeof settings.taskPrefix === "string") {
      const taskPrefix = settings.taskPrefix.trim();
      data.taskPrefix = taskPrefix.length > 0 ? taskPrefix.slice(0, 20) : null;
    }
    if (typeof settings.themeColor === "string") {
      const themeColor = settings.themeColor.trim();
      data.themeColor = themeColor.length > 0 ? themeColor.slice(0, 32) : null;
    }
    return data;
  }

  private resolveReportRange(
    fromInput?: string,
    toInput?: string,
  ): { from: Date; to: Date } {
    const to = toInput ? new Date(toInput) : new Date();
    if (Number.isNaN(to.getTime())) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Invalid to datetime",
      });
    }

    const from = fromInput
      ? new Date(fromInput)
      : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    if (Number.isNaN(from.getTime())) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Invalid from datetime",
      });
    }
    if (from > to) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "`from` must be before `to`",
      });
    }
    return { from, to };
  }

  private toCsv(
    headers: string[],
    rows: Array<Array<string | number | null | undefined>>,
  ): string {
    const escapeCell = (value: string | number | null | undefined): string => {
      if (value === null || value === undefined) {
        return "";
      }
      const asString = String(value);
      if (
        asString.includes(",") ||
        asString.includes("\"") ||
        asString.includes("\n")
      ) {
        return `"${asString.replace(/"/g, "\"\"")}"`;
      }
      return asString;
    };

    const lines = [
      headers.map((header) => escapeCell(header)).join(","),
      ...rows.map((row) => row.map((cell) => escapeCell(cell)).join(",")),
    ];
    return lines.join("\n");
  }

  private async resolveWorkspacePrimaryProjectId(
    userId: string,
    workspaceId: string,
    access: "view" | "edit" | "admin",
    systemRole?: string,
  ): Promise<string> {
    const allowedRoles =
      access === "view" ? VIEW_ROLES : access === "edit" ? EDIT_ROLES : ADMIN_ROLES;
    const workspaceContext = await this.requireWorkspaceRole(
      userId,
      workspaceId,
      allowedRoles,
      systemRole,
    );

    const existing = await this.prisma.project.findFirst({
      where: {
        workspaceId,
        status: ProjectStatus.ACTIVE,
        archivedAt: null,
      },
      orderBy: [{ createdAt: "asc" }],
      select: { id: true },
    });
    if (existing) {
      return existing.id;
    }

    if (workspaceContext.role === WorkspaceRole.VIEWER) {
      throw new NotFoundException({
        code: "WORKSPACE_BOARD_NOT_READY",
        message: "Workspace board is not ready yet",
      });
    }

    const createdProjectId = await this.prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.findUnique({
        where: { id: workspaceId },
        select: { id: true, name: true, ownerUserId: true },
      });
      if (!workspace) {
        throw new NotFoundException({
          code: "WORKSPACE_NOT_FOUND",
          message: "Workspace not found",
        });
      }

      const project = await tx.project.create({
        data: {
          workspaceId: workspace.id,
          ownerUserId: workspace.ownerUserId,
          name: workspace.name,
          description: null,
          visibility: ProjectVisibility.WORKSPACE,
          defaultView: ProjectViewType.BOARD,
          createdByUserId: userId,
          updatedByUserId: userId,
          status: ProjectStatus.ACTIVE,
        },
      });

      await tx.taskColumn.createMany({
        data: [
          { projectId: project.id, name: "Todo", position: 0 },
          { projectId: project.id, name: "In Progress", position: 1 },
          { projectId: project.id, name: "Done", position: 2 },
        ],
      });

      const workspaceMembers = await tx.workspaceMember.findMany({
        where: {
          workspaceId: workspace.id,
          status: MembershipStatus.ACTIVE,
        },
        select: {
          userId: true,
          role: true,
          invitedByUserId: true,
        },
      });
      if (workspaceMembers.length > 0) {
        await tx.projectMember.createMany({
          data: workspaceMembers.map((member) => ({
            projectId: project.id,
            userId: member.userId,
            role: member.role,
            status: MembershipStatus.ACTIVE,
            invitedByUserId: member.invitedByUserId ?? userId,
          })),
          skipDuplicates: true,
        });
      }

      await tx.projectSetting.create({
        data: {
          projectId: project.id,
          defaultView: ProjectViewType.BOARD,
        },
      });

      await this.recordActivity(tx, {
        workspaceId: workspace.id,
        projectId: project.id,
        actorUserId: userId,
        action: "WORKSPACE_BOARD_BOOTSTRAPPED",
        entityType: "project",
        entityId: project.id,
        payload: {
          workspaceName: workspace.name,
        },
      });

      return project.id;
    });

    return createdProjectId;
  }

  private async requireProjectAccess(
    userId: string,
    projectId: string,
    access: "view" | "edit" | "admin",
    systemRole?: string,
  ): Promise<{
    project: {
      id: string;
      workspaceId: string;
      ownerUserId: string;
      visibility: ProjectVisibility;
      defaultView: ProjectViewType;
      name: string;
      status: ProjectStatus;
      archivedAt: Date | null;
    };
    workspaceRole: WorkspaceRole;
    projectRole: WorkspaceRole | null;
  }> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        members: {
          where: {
            userId,
            status: MembershipStatus.ACTIVE,
          },
          take: 1,
        },
      },
    });
    if (!project) {
      throw new NotFoundException({
        code: "PROJECT_NOT_FOUND",
        message: "Project not found",
      });
    }

    const workspaceContext = await this.requireWorkspaceRole(
      userId,
      project.workspaceId,
      VIEW_ROLES,
      systemRole,
    );
    const isWorkspaceAdmin = ADMIN_ROLES.includes(workspaceContext.role);
    const projectRole = project.members[0]?.role ?? null;

    if (!isWorkspaceAdmin) {
      if (access === "edit" && workspaceContext.role === WorkspaceRole.VIEWER) {
        throw new ForbiddenException({
          code: "PROJECT_FORBIDDEN",
          message: "Insufficient project permission",
        });
      }
      if (access === "admin") {
        throw new ForbiddenException({
          code: "PROJECT_FORBIDDEN",
          message: "Admin permission required for project",
        });
      }
    }

    return {
      project,
      workspaceRole: workspaceContext.role,
      projectRole,
    };
  }

  private async lookupUserByEmail(emailInput: string): Promise<DirectoryUser | null> {
    const email = String(emailInput || "").trim().toLowerCase();
    if (!email) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Email is required",
      });
    }
    if (!this.authInternalBaseUrl || !this.internalProxySecret) {
      throw new ServiceUnavailableException({
        code: "AUTH_DIRECTORY_UNAVAILABLE",
        message: "Auth internal lookup is unavailable",
      });
    }

    const url = new URL(`${this.authInternalBaseUrl}/users/by-email`);
    url.searchParams.set("email", email);

    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "x-proxy-secret": this.internalProxySecret,
        },
      });
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new ServiceUnavailableException({
          code: "AUTH_DIRECTORY_ERROR",
          message: "Cannot verify user email",
        });
      }
      const body = (await response.json()) as { user?: Record<string, unknown> };
      const normalized = this.toDirectoryUser(body.user);
      if (!normalized) {
        return null;
      }
      return normalized;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      throw new ServiceUnavailableException({
        code: "AUTH_DIRECTORY_ERROR",
        message: "Cannot verify user email",
      });
    }
  }

  private async lookupUsersByIds(userIds: string[]): Promise<Map<string, DirectoryUser>> {
    const uniqueIds = Array.from(
      new Set(
        (Array.isArray(userIds) ? userIds : []).filter((id) => typeof id === "string" && id.length > 0),
      ),
    );
    if (uniqueIds.length === 0) {
      return new Map();
    }
    if (!this.authInternalBaseUrl || !this.internalProxySecret) {
      return new Map();
    }

    const url = new URL(`${this.authInternalBaseUrl}/users/by-ids`);
    for (const id of uniqueIds) {
      url.searchParams.append("ids", id);
    }

    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "x-proxy-secret": this.internalProxySecret,
        },
      });
      if (!response.ok) {
        return new Map();
      }

      const body = (await response.json()) as { users?: unknown[] };
      const users = Array.isArray(body.users) ? body.users : [];
      const mapped = new Map<string, DirectoryUser>();
      for (const user of users) {
        const normalized = this.toDirectoryUser(user);
        if (!normalized) {
          continue;
        }
        mapped.set(normalized.id, normalized);
      }
      return mapped;
    } catch {
      return new Map();
    }
  }

  private toDirectoryUser(input: unknown): DirectoryUser | null {
    if (!input || typeof input !== "object") {
      return null;
    }
    const record = input as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const emailRaw = typeof record.email === "string" ? record.email.trim().toLowerCase() : "";
    if (!id || !emailRaw) {
      return null;
    }

    return {
      id,
      email: emailRaw,
      displayName:
        typeof record.displayName === "string" && record.displayName.trim().length > 0
          ? record.displayName.trim()
          : null,
      fullName:
        typeof record.fullName === "string" && record.fullName.trim().length > 0
          ? record.fullName.trim()
          : null,
      firstName:
        typeof record.firstName === "string" && record.firstName.trim().length > 0
          ? record.firstName.trim()
          : null,
      lastName:
        typeof record.lastName === "string" && record.lastName.trim().length > 0
          ? record.lastName.trim()
          : null,
      avatarUrl:
        typeof record.avatarUrl === "string" && record.avatarUrl.trim().length > 0
          ? record.avatarUrl.trim()
          : null,
    };
  }

  private withDirectoryProfile<T extends { userId: string }>(
    member: T,
    user: DirectoryUser | null,
  ): T & {
    user: {
      id: string;
      email: string | null;
      displayName: string | null;
      fullName: string | null;
      firstName: string | null;
      lastName: string | null;
      avatarUrl: string | null;
    };
  } {
    return {
      ...member,
      user: {
        id: member.userId,
        email: user?.email ?? null,
        displayName: user?.displayName ?? null,
        fullName: user?.fullName ?? null,
        firstName: user?.firstName ?? null,
        lastName: user?.lastName ?? null,
        avatarUrl: user?.avatarUrl ?? null,
      },
    };
  }

  private async attachDirectoryProfiles<T extends { userId: string }>(
    members: T[],
  ): Promise<
    Array<
      T & {
        user: {
          id: string;
          email: string | null;
          displayName: string | null;
          fullName: string | null;
          firstName: string | null;
          lastName: string | null;
          avatarUrl: string | null;
        };
      }
    >
  > {
    const usersById = await this.lookupUsersByIds(members.map((member) => member.userId));
    return members.map((member) =>
      this.withDirectoryProfile(member, usersById.get(member.userId) ?? null),
    );
  }

  private async requireWorkspaceRole(
    userId: string,
    workspaceId: string,
    allowedRoles: WorkspaceRole[],
    systemRole?: string,
  ): Promise<WorkspaceContext> {
    const normalizedSystemRole = String(systemRole ?? "")
      .trim()
      .toUpperCase();
    if (normalizedSystemRole && SYSTEM_ADMIN_ROLES.has(normalizedSystemRole)) {
      return {
        id: workspaceId,
        role: WorkspaceRole.OWNER,
      };
    }

    const membership = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId,
        },
      },
    });

    if (!membership || membership.status !== MembershipStatus.ACTIVE) {
      throw new ForbiddenException({
        code: "WORKSPACE_FORBIDDEN",
        message: "You are not a workspace member",
      });
    }
    if (!allowedRoles.includes(membership.role)) {
      throw new ForbiddenException({
        code: "WORKSPACE_FORBIDDEN",
        message: "Insufficient workspace permission",
      });
    }

    return {
      id: workspaceId,
      role: membership.role,
    };
  }

  private async recordActivity(
    tx: PrismaTx | PrismaService,
    input: {
      workspaceId: string;
      projectId?: string;
      taskId?: string;
      actorUserId: string;
      action: string;
      entityType: string;
      entityId: string;
      payload?: Record<string, unknown>;
    },
  ): Promise<void> {
    await tx.activity.create({
      data: {
        workspaceId: input.workspaceId,
        projectId: input.projectId ?? null,
        taskId: input.taskId ?? null,
        actorUserId: input.actorUserId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        payload: (input.payload ?? null) as Prisma.InputJsonValue,
      },
    });
  }

  private async runIdempotentMutation<T>(
    tx: PrismaTx,
    key: string | undefined,
    userId: string,
    action: string,
    requestPayload: unknown,
    execute: () => Promise<T>,
  ): Promise<T> {
    if (!key) {
      return execute();
    }
    const requestHash = this.hashRequestPayload(requestPayload);
    const existing = await tx.idempotencyRecord.findUnique({
      where: {
        key_userId_action: {
          key,
          userId,
          action,
        },
      },
    });

    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ConflictException({
          code: "IDEMPOTENCY_CONFLICT",
          message: "Idempotency key was already used with different payload",
        });
      }

      return existing.response as T;
    }

    const result = await execute();
    await tx.idempotencyRecord.create({
      data: {
        key,
        userId,
        action,
        requestHash,
        response: this.toJsonValue(result),
      },
    });

    return result;
  }

  private normalizeIdempotencyKey(
    value: string | undefined,
  ): string | undefined {
    if (!value) {
      return undefined;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    if (trimmed.length > 128) {
      throw new BadRequestException({
        code: "IDEMPOTENCY_KEY_INVALID",
        message: "Idempotency key too long",
      });
    }
    return trimmed;
  }

  private hashRequestPayload(payload: unknown): string {
    return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  }

  private toJsonValue(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private resolvePagination(
    page?: number,
    limit?: number,
  ): {
    page: number;
    limit: number;
    skip: number;
  } {
    const safePage =
      Number.isInteger(page) && (page ?? 0) > 0 ? (page as number) : 1;
    const safeLimit =
      Number.isInteger(limit) && (limit ?? 0) > 0
        ? Math.min(limit as number, 100)
        : 20;
    return {
      page: safePage,
      limit: safeLimit,
      skip: (safePage - 1) * safeLimit,
    };
  }

  private toPaginationMeta(
    total: number,
    page: number,
    limit: number,
  ): PaginationMeta {
    return {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }
}

