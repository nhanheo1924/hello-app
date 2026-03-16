import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  Prisma,
  ProjectStatus,
  TaskPriority,
  TaskStatus,
  WorkspaceRole,
} from "@prisma/client";
import { createHash } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { BoardQueryDto } from "./dto/board-query.dto";
import { CreateCommentDto } from "./dto/create-comment.dto";
import { CreateProjectDto } from "./dto/create-project.dto";
import { CreateTaskDto } from "./dto/create-task.dto";
import { CreateWorkspaceDto } from "./dto/create-workspace.dto";
import { MoveTaskDto } from "./dto/move-task.dto";
import { UpdateProjectDto } from "./dto/update-project.dto";
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

const VIEW_ROLES = [
  WorkspaceRole.OWNER,
  WorkspaceRole.ADMIN,
  WorkspaceRole.MEMBER,
  WorkspaceRole.VIEWER,
];
const EDIT_ROLES = [
  WorkspaceRole.OWNER,
  WorkspaceRole.ADMIN,
  WorkspaceRole.MEMBER,
];
const ADMIN_ROLES = [WorkspaceRole.OWNER, WorkspaceRole.ADMIN];

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  async listWorkspaces(userId: string, page?: number, limit?: number) {
    const pagination = this.resolvePagination(page, limit);
    const total = await this.prisma.workspaceMember.count({
      where: { userId },
    });

    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId },
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
        ownerId: membership.workspace.ownerId,
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
          ownerId: userId,
        },
      });
      await tx.workspaceMember.create({
        data: {
          workspaceId: createdWorkspace.id,
          userId,
          role: WorkspaceRole.OWNER,
        },
      });
      await this.recordActivity(tx, {
        workspaceId: createdWorkspace.id,
        actorId: userId,
        action: "WORKSPACE_CREATED",
        entityType: "workspace",
        entityId: createdWorkspace.id,
        payload: {
          name: createdWorkspace.name,
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
        ownerId: workspace.ownerId,
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
      actorId: userId,
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

    const total = await this.prisma.project.count({
      where: { workspaceId },
    });

    const projects = await this.prisma.project.findMany({
      where: { workspaceId },
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
        createdBy: project.createdBy,
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
    const context = await this.requireWorkspaceRole(
      userId,
      workspaceId,
      EDIT_ROLES,
    );

    const name = dto.name.trim();
    const description = dto.description?.trim() || null;

    const project = await this.prisma.$transaction(async (tx) => {
      const createdProject = await tx.project.create({
        data: {
          workspaceId,
          name,
          description,
          createdBy: userId,
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
          role: context.role,
        },
      });

      await this.recordActivity(tx, {
        workspaceId,
        projectId: createdProject.id,
        actorId: userId,
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
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new NotFoundException({
        code: "PROJECT_NOT_FOUND",
        message: "Project not found",
      });
    }
    await this.requireWorkspaceRole(userId, project.workspaceId, ADMIN_ROLES);

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

    if (Object.keys(data).length === 0) {
      return {
        data: project,
      };
    }

    const updated = await this.prisma.project.update({
      where: { id: projectId },
      data,
    });

    await this.recordActivity(this.prisma, {
      workspaceId: updated.workspaceId,
      projectId: updated.id,
      actorId: userId,
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
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) {
      throw new NotFoundException({
        code: "PROJECT_NOT_FOUND",
        message: "Project not found",
      });
    }

    await this.requireWorkspaceRole(userId, project.workspaceId, ADMIN_ROLES);

    await this.prisma.$transaction(async (tx) => {
      await this.recordActivity(tx, {
        workspaceId: project.workspaceId,
        projectId: project.id,
        actorId: userId,
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

  async getBoard(userId: string, projectId: string, query: BoardQueryDto) {
    const project = await this.prisma.project.findUnique({
      where: {
        id: projectId,
      },
    });
    if (!project) {
      throw new NotFoundException({
        code: "PROJECT_NOT_FOUND",
        message: "Project not found",
      });
    }

    const context = await this.requireWorkspaceRole(
      userId,
      project.workspaceId,
      VIEW_ROLES,
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
          createdBy: board.createdBy,
          createdAt: board.createdAt,
          updatedAt: board.updatedAt,
          workspaceRole: context.role,
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
          assigneeId: query.assigneeId ?? null,
          dueFrom: query.dueFrom ?? null,
          dueTo: query.dueTo ?? null,
          q: query.q ?? null,
        },
      },
    };
  }

  async createTask(userId: string, projectId: string, dto: CreateTaskDto) {
    const project = await this.prisma.project.findUnique({
      where: {
        id: projectId,
      },
    });
    if (!project) {
      throw new NotFoundException({
        code: "PROJECT_NOT_FOUND",
        message: "Project not found",
      });
    }
    await this.requireWorkspaceRole(userId, project.workspaceId, EDIT_ROLES);

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
          dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
          assigneeId: dto.assigneeId ?? null,
          orderIndex,
          createdBy: userId,
        },
      });

      await this.recordActivity(tx, {
        workspaceId: project.workspaceId,
        projectId: project.id,
        taskId: createdTask.id,
        actorId: userId,
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

    return {
      data: task,
    };
  }

  async updateTask(
    userId: string,
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
    await this.requireWorkspaceRole(
      userId,
      task.project.workspaceId,
      EDIT_ROLES,
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
          }
          if (dto.dueAt !== undefined) {
            data.dueAt = dto.dueAt ? new Date(dto.dueAt) : null;
          }
          if (dto.assigneeId !== undefined) {
            data.assigneeId = dto.assigneeId;
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
            actorId: userId,
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

    return result;
  }

  async moveTask(
    userId: string,
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
    await this.requireWorkspaceRole(
      userId,
      task.project.workspaceId,
      EDIT_ROLES,
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
            actorId: userId,
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

  async deleteTask(userId: string, taskId: string) {
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
    await this.requireWorkspaceRole(
      userId,
      task.project.workspaceId,
      EDIT_ROLES,
    );

    await this.prisma.$transaction(async (tx) => {
      await this.recordActivity(tx, {
        workspaceId: task.project.workspaceId,
        projectId: task.projectId,
        taskId: task.id,
        actorId: userId,
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
    await this.requireWorkspaceRole(
      userId,
      task.project.workspaceId,
      VIEW_ROLES,
    );

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
    await this.requireWorkspaceRole(
      userId,
      task.project.workspaceId,
      EDIT_ROLES,
    );

    const comment = await this.prisma.$transaction(async (tx) => {
      const createdComment = await tx.taskComment.create({
        data: {
          taskId,
          authorId: userId,
          content: dto.content.trim(),
        },
      });
      await this.recordActivity(tx, {
        workspaceId: task.project.workspaceId,
        projectId: task.projectId,
        taskId: task.id,
        actorId: userId,
        action: "COMMENT_CREATED",
        entityType: "comment",
        entityId: createdComment.id,
        payload: {
          taskId,
        },
      });
      return createdComment;
    });

    return {
      data: comment,
    };
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
    if (query.assigneeId) {
      where.assigneeId = query.assigneeId;
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

  private async requireWorkspaceRole(
    userId: string,
    workspaceId: string,
    allowedRoles: WorkspaceRole[],
  ): Promise<WorkspaceContext> {
    const membership = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId,
        },
      },
    });

    if (!membership) {
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
      actorId: string;
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
        actorId: input.actorId,
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
