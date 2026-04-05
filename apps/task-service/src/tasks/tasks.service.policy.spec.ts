import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { MembershipStatus, ProjectViewType, WorkspaceRole } from "@prisma/client";
import { TasksService } from "./tasks.service";

function createService() {
  const prisma = {
    projectSetting: {
      upsert: jest.fn(),
    },
    task: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    project: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    taskComment: {
      create: jest.fn(),
    },
    workspaceMember: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    projectMember: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  } as any;

  const config = {
    get: jest.fn((_: string, defaultValue?: unknown) => defaultValue),
  } as any;

  const service = new TasksService(prisma, config);
  return { service, prisma };
}

describe("TasksService policy guards", () => {
  const directoryUser = {
    id: "user-2",
    email: "user2@example.com",
    displayName: null,
    fullName: null,
    firstName: null,
    lastName: null,
    avatarUrl: null,
  };

  it("blocks member task reorder when policy is disabled", async () => {
    const { service, prisma } = createService();
    prisma.projectSetting.upsert.mockResolvedValue({
      allowTaskReorder: false,
    });

    const access = {
      project: { id: "project-1", defaultView: ProjectViewType.BOARD },
      workspaceRole: WorkspaceRole.MEMBER,
      projectRole: WorkspaceRole.MEMBER,
    };

    await expect(
      (service as any).assertMemberPolicyAllowed(
        access,
        "allowTaskReorder",
        "Task reorder is disabled for members",
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("allows admin to bypass member-only task policy checks", async () => {
    const { service, prisma } = createService();

    const access = {
      project: { id: "project-1", defaultView: ProjectViewType.BOARD },
      workspaceRole: WorkspaceRole.ADMIN,
      projectRole: null,
    };

    await expect(
      (service as any).assertMemberPolicyAllowed(
        access,
        "allowTaskDeleteByMember",
        "Task deletion is disabled for members",
      ),
    ).resolves.toBeUndefined();
    expect(prisma.projectSetting.upsert).not.toHaveBeenCalled();
  });

  it("blocks project invite when allowMemberInvite is disabled for non-admin member", async () => {
    const { service } = createService();
    jest.spyOn(service as any, "requireProjectAccess").mockResolvedValue({
      project: {
        id: "project-1",
        workspaceId: "workspace-1",
        defaultView: ProjectViewType.BOARD,
      },
      workspaceRole: WorkspaceRole.MEMBER,
      projectRole: WorkspaceRole.MEMBER,
    });
    jest.spyOn(service as any, "ensureProjectSettings").mockResolvedValue({
      allowMemberInvite: false,
    });
    const lookupSpy = jest.spyOn(service as any, "lookupUserByEmail");

    await expect(
      service.addProjectMemberByEmail("user-1", "project-1", {
        email: "new-member@example.com",
        role: WorkspaceRole.MEMBER,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(lookupSpy).not.toHaveBeenCalled();
  });

  it("returns USER_NOT_REGISTERED when invited email is unknown", async () => {
    const { service } = createService();
    jest.spyOn(service as any, "requireProjectAccess").mockResolvedValue({
      project: {
        id: "project-1",
        workspaceId: "workspace-1",
        defaultView: ProjectViewType.BOARD,
      },
      workspaceRole: WorkspaceRole.MEMBER,
      projectRole: WorkspaceRole.MEMBER,
    });
    jest.spyOn(service as any, "ensureProjectSettings").mockResolvedValue({
      allowMemberInvite: true,
    });
    jest.spyOn(service as any, "lookupUserByEmail").mockResolvedValue(null);

    let thrown: unknown;
    try {
      await service.addProjectMemberByEmail("user-1", "project-1", {
        email: "missing@example.com",
        role: WorkspaceRole.MEMBER,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(BadRequestException);
    expect((thrown as BadRequestException).getResponse()).toMatchObject({
      code: "USER_NOT_REGISTERED",
    });
  });

  it("blocks assigning OWNER role to non-owner project member", async () => {
    const { service } = createService();
    jest.spyOn(service as any, "requireProjectAccess").mockResolvedValue({
      project: {
        id: "project-1",
        workspaceId: "workspace-1",
        ownerUserId: "owner-1",
        defaultView: ProjectViewType.BOARD,
      },
      workspaceRole: WorkspaceRole.ADMIN,
      projectRole: WorkspaceRole.ADMIN,
    });
    jest.spyOn(service as any, "ensureProjectSettings").mockResolvedValue({
      allowMemberInvite: true,
    });
    jest.spyOn(service as any, "lookupUserByEmail").mockResolvedValue({
      id: "user-2",
      email: "user2@example.com",
      displayName: null,
      fullName: null,
      firstName: null,
      lastName: null,
      avatarUrl: null,
    });

    await expect(
      service.addProjectMemberByEmail("admin-1", "project-1", {
        email: "user2@example.com",
        role: WorkspaceRole.OWNER,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("blocks changing project owner role to non-owner", async () => {
    const { service, prisma } = createService();
    jest.spyOn(service as any, "requireProjectAccess").mockResolvedValue({
      project: {
        id: "project-1",
        workspaceId: "workspace-1",
        ownerUserId: "owner-1",
      },
      workspaceRole: WorkspaceRole.ADMIN,
      projectRole: WorkspaceRole.ADMIN,
    });
    prisma.projectMember.findUnique.mockResolvedValue({
      projectId: "project-1",
      userId: "owner-1",
      role: WorkspaceRole.OWNER,
      status: "ACTIVE",
    });

    await expect(
      service.updateProjectMemberRole("admin-1", "project-1", "owner-1", {
        role: WorkspaceRole.ADMIN,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("allows MEMBER to invite MEMBER and VIEWER workspace roles", async () => {
    const { service, prisma } = createService();
    jest.spyOn(service as any, "requireWorkspaceRole").mockResolvedValue({
      id: "workspace-1",
      role: WorkspaceRole.MEMBER,
    });
    jest.spyOn(service as any, "lookupUserByEmail").mockResolvedValue(directoryUser);
    jest.spyOn(service as any, "recordActivity").mockResolvedValue(undefined);
    prisma.workspaceMember.upsert.mockImplementation(
      async (payload: { create: { role: WorkspaceRole; userId: string } }) => ({
        workspaceId: "workspace-1",
        userId: payload.create.userId,
        role: payload.create.role,
        status: MembershipStatus.ACTIVE,
      }),
    );

    await expect(
      service.addWorkspaceMemberByEmail("member-1", "workspace-1", {
        email: "user2@example.com",
        role: WorkspaceRole.MEMBER,
      }),
    ).resolves.toMatchObject({
      data: { role: WorkspaceRole.MEMBER },
    });
    await expect(
      service.addWorkspaceMemberByEmail("member-1", "workspace-1", {
        email: "user2@example.com",
        role: WorkspaceRole.VIEWER,
      }),
    ).resolves.toMatchObject({
      data: { role: WorkspaceRole.VIEWER },
    });
    expect(prisma.workspaceMember.upsert).toHaveBeenCalledTimes(2);
  });

  it("blocks MEMBER from inviting ADMIN or OWNER workspace roles", async () => {
    const { service } = createService();
    jest.spyOn(service as any, "requireWorkspaceRole").mockResolvedValue({
      id: "workspace-1",
      role: WorkspaceRole.MEMBER,
    });
    const lookupSpy = jest.spyOn(service as any, "lookupUserByEmail");

    await expect(
      service.addWorkspaceMemberByEmail("member-1", "workspace-1", {
        email: "admin@example.com",
        role: WorkspaceRole.ADMIN,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.addWorkspaceMemberByEmail("member-1", "workspace-1", {
        email: "owner@example.com",
        role: WorkspaceRole.OWNER,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(lookupSpy).not.toHaveBeenCalled();
  });

  it("blocks MEMBER from updating or removing workspace members", async () => {
    const { service, prisma } = createService();
    prisma.workspaceMember.findUnique.mockResolvedValue({
      workspaceId: "workspace-1",
      userId: "member-1",
      role: WorkspaceRole.MEMBER,
      status: MembershipStatus.ACTIVE,
    });

    await expect(
      service.updateWorkspaceMemberRole(
        "member-1",
        "workspace-1",
        "member-2",
        { role: WorkspaceRole.ADMIN },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.removeWorkspaceMember("member-1", "workspace-1", "member-2"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("allows ADMIN to promote non-owner workspace members to ADMIN", async () => {
    const { service, prisma } = createService();
    prisma.workspaceMember.findUnique
      .mockResolvedValueOnce({
        workspaceId: "workspace-1",
        userId: "admin-1",
        role: WorkspaceRole.ADMIN,
        status: MembershipStatus.ACTIVE,
      })
      .mockResolvedValueOnce({
        workspaceId: "workspace-1",
        userId: "member-1",
        role: WorkspaceRole.MEMBER,
        status: MembershipStatus.ACTIVE,
      });
    prisma.workspaceMember.update.mockResolvedValue({
      workspaceId: "workspace-1",
      userId: "member-1",
      role: WorkspaceRole.ADMIN,
      status: MembershipStatus.ACTIVE,
    });
    jest.spyOn(service as any, "recordActivity").mockResolvedValue(undefined);
    jest.spyOn(service as any, "pushNotification").mockResolvedValue(undefined);
    jest.spyOn(service as any, "lookupUsersByIds").mockResolvedValue(
      new Map([[directoryUser.id, directoryUser]]),
    );

    await expect(
      service.updateWorkspaceMemberRole(
        "admin-1",
        "workspace-1",
        "member-1",
        { role: WorkspaceRole.ADMIN },
      ),
    ).resolves.toMatchObject({
      data: { role: WorkspaceRole.ADMIN },
    });
  });

  it("blocks mutating owner workspace membership", async () => {
    const { service, prisma } = createService();
    prisma.workspaceMember.findUnique
      .mockResolvedValueOnce({
        workspaceId: "workspace-1",
        userId: "admin-1",
        role: WorkspaceRole.ADMIN,
        status: MembershipStatus.ACTIVE,
      })
      .mockResolvedValueOnce({
        workspaceId: "workspace-1",
        userId: "owner-1",
        role: WorkspaceRole.OWNER,
        status: MembershipStatus.ACTIVE,
      })
      .mockResolvedValueOnce({
        workspaceId: "workspace-1",
        userId: "admin-1",
        role: WorkspaceRole.ADMIN,
        status: MembershipStatus.ACTIVE,
      })
      .mockResolvedValueOnce({
        workspaceId: "workspace-1",
        userId: "owner-1",
        role: WorkspaceRole.OWNER,
        status: MembershipStatus.ACTIVE,
      });

    await expect(
      service.updateWorkspaceMemberRole(
        "admin-1",
        "workspace-1",
        "owner-1",
        { role: WorkspaceRole.MEMBER },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.removeWorkspaceMember("admin-1", "workspace-1", "owner-1"),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("blocks viewer task mutations via edit access guard", async () => {
    const { service, prisma } = createService();
    prisma.project.findUnique.mockResolvedValue({
      id: "project-1",
      workspaceId: "workspace-1",
      ownerUserId: "owner-1",
      visibility: "PRIVATE",
      defaultView: ProjectViewType.BOARD,
      name: "Demo",
      status: "ACTIVE",
      archivedAt: null,
      members: [{ role: WorkspaceRole.MEMBER }],
    });
    jest.spyOn(service as any, "requireWorkspaceRole").mockResolvedValue({
      id: "workspace-1",
      role: WorkspaceRole.VIEWER,
    });

    await expect(
      (service as any).requireProjectAccess("viewer-1", "project-1", "edit"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("blocks viewer comments even when allowViewerComment is enabled", async () => {
    const { service, prisma } = createService();
    prisma.task.findUnique.mockResolvedValue({
      id: "task-1",
      projectId: "project-1",
      project: { workspaceId: "workspace-1" },
    });
    prisma.taskComment.create.mockResolvedValue({
      id: "comment-1",
      taskId: "task-1",
    });
    jest.spyOn(service as any, "requireProjectAccess").mockResolvedValue({
      project: {
        id: "project-1",
        workspaceId: "workspace-1",
        defaultView: ProjectViewType.BOARD,
      },
      workspaceRole: WorkspaceRole.VIEWER,
      projectRole: WorkspaceRole.VIEWER,
    });
    const settingsSpy = jest
      .spyOn(service as any, "ensureProjectSettings")
      .mockResolvedValue({
      allowViewerComment: true,
    });
    jest.spyOn(service as any, "recordActivity").mockResolvedValue(undefined);

    await expect(
      service.createComment("viewer-1", "task-1", {
        content: "viewer comment",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(settingsSpy).not.toHaveBeenCalled();
    expect(prisma.taskComment.create).not.toHaveBeenCalled();
  });

  it("returns projectRole in calendar payload for role-based UI", async () => {
    const { service, prisma } = createService();
    jest.spyOn(service as any, "requireProjectAccess").mockResolvedValue({
      project: {
        id: "project-1",
        workspaceId: "workspace-1",
        name: "Demo",
        visibility: "PRIVATE",
        defaultView: ProjectViewType.BOARD,
      },
      workspaceRole: WorkspaceRole.ADMIN,
      projectRole: WorkspaceRole.MEMBER,
    });
    prisma.task.findMany.mockResolvedValue([
      {
        id: "task-1",
        taskLabels: [],
      },
    ]);

    const result = await service.getCalendar("user-1", "project-1", {});
    expect(result.data.project.projectRole).toBe(WorkspaceRole.MEMBER);
  });

  it("returns projectRole in board payload for role-based UI", async () => {
    const { service, prisma } = createService();
    jest.spyOn(service as any, "requireProjectAccess").mockResolvedValue({
      project: {
        id: "project-1",
      },
      workspaceRole: WorkspaceRole.ADMIN,
      projectRole: WorkspaceRole.MEMBER,
    });
    prisma.project.findUniqueOrThrow.mockResolvedValue({
      id: "project-1",
      workspaceId: "workspace-1",
      name: "Demo",
      description: null,
      status: "ACTIVE",
      visibility: "PRIVATE",
      defaultView: ProjectViewType.BOARD,
      createdByUserId: "user-1",
      createdAt: new Date(),
      updatedAt: new Date(),
      columns: [
        {
          id: "col-1",
          projectId: "project-1",
          name: "Todo",
          position: 0,
          tasks: [
            {
              id: "task-1",
              taskLabels: [],
              _count: { comments: 0 },
            },
          ],
        },
      ],
    });

    const result = await service.getBoard("user-1", "project-1", {});
    expect(result.data.project.projectRole).toBe(WorkspaceRole.MEMBER);
  });

  it("matches permission matrix for VIEWER/MEMBER/ADMIN/OWNER", () => {
    const { service } = createService();

    expect(
      (service as any).canProjectEdit(
        WorkspaceRole.VIEWER,
        WorkspaceRole.VIEWER,
      ),
    ).toBe(false);
    expect(
      (service as any).canProjectEdit(
        WorkspaceRole.VIEWER,
        WorkspaceRole.MEMBER,
      ),
    ).toBe(true);
    expect((service as any).canProjectEdit(WorkspaceRole.ADMIN, null)).toBe(
      true,
    );
    expect(
      (service as any).canProjectAdmin(
        WorkspaceRole.VIEWER,
        WorkspaceRole.OWNER,
      ),
    ).toBe(true);
  });
});
