import { BadRequestException } from "@nestjs/common";
import { WorkspaceRole } from "@prisma/client";
import { TasksService } from "./tasks.service";

function createService() {
  const prisma = {
    workspaceSetting: {
      upsert: jest.fn(),
    },
  } as any;

  const config = {
    get: jest.fn((_: string, defaultValue?: unknown) => defaultValue),
  } as any;

  const service = new TasksService(prisma, config);
  return { service, prisma };
}

describe("TasksService workspace settings", () => {
  it("returns serialized default workspace settings", async () => {
    const { service, prisma } = createService();
    prisma.workspaceSetting.upsert.mockResolvedValue({
      workspaceId: "workspace-1",
      startDate: null,
      endDate: null,
      hourFormat: "24",
      showWeekends: true,
      weekStart: "mon",
      defaultDurationHours: 2,
    });

    jest.spyOn(service as any, "requireWorkspaceRole").mockResolvedValue({
      id: "workspace-1",
      role: WorkspaceRole.OWNER,
    });

    const result = await service.getWorkspaceSettings("user-1", "workspace-1");

    expect(result).toEqual({
      data: {
        startDate: null,
        endDate: null,
        hourFormat: "24",
        showWeekends: true,
        weekStart: "mon",
        defaultDurationHours: 2,
      },
    });
  });

  it("updates workspace settings using current values for omitted fields", async () => {
    const { service, prisma } = createService();
    prisma.workspaceSetting.upsert
      .mockResolvedValueOnce({
        workspaceId: "workspace-1",
        startDate: new Date("2026-04-01T00:00:00.000Z"),
        endDate: new Date("2026-04-10T00:00:00.000Z"),
        hourFormat: "24",
        showWeekends: true,
        weekStart: "mon",
        defaultDurationHours: 2,
      })
      .mockResolvedValueOnce({
        workspaceId: "workspace-1",
        startDate: new Date("2026-04-01T00:00:00.000Z"),
        endDate: new Date("2026-04-10T00:00:00.000Z"),
        hourFormat: "12",
        showWeekends: true,
        weekStart: "sun",
        defaultDurationHours: 1.5,
      });

    jest.spyOn(service as any, "requireWorkspaceRole").mockResolvedValue({
      id: "workspace-1",
      role: WorkspaceRole.ADMIN,
    });
    jest.spyOn(service as any, "recordActivity").mockResolvedValue(undefined);

    const result = await service.updateWorkspaceSettings("user-1", "workspace-1", {
      hourFormat: "12",
      weekStart: "sun",
      defaultDurationHours: 1.5,
    });

    expect(prisma.workspaceSetting.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { workspaceId: "workspace-1" },
        update: {
          hourFormat: "12",
          weekStart: "sun",
          defaultDurationHours: 1.5,
        },
      }),
    );
    expect(result).toEqual({
      data: {
        startDate: "2026-04-01",
        endDate: "2026-04-10",
        hourFormat: "12",
        showWeekends: true,
        weekStart: "sun",
        defaultDurationHours: 1.5,
      },
    });
  });

  it("rejects invalid workspace setting date ranges and duration steps", async () => {
    const { service, prisma } = createService();
    prisma.workspaceSetting.upsert.mockResolvedValue({
      workspaceId: "workspace-1",
      startDate: null,
      endDate: null,
      hourFormat: "24",
      showWeekends: true,
      weekStart: "mon",
      defaultDurationHours: 2,
    });

    jest.spyOn(service as any, "requireWorkspaceRole").mockResolvedValue({
      id: "workspace-1",
      role: WorkspaceRole.ADMIN,
    });

    await expect(
      service.updateWorkspaceSettings("user-1", "workspace-1", {
        startDate: "2026-04-20",
        endDate: "2026-04-10",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.updateWorkspaceSettings("user-1", "workspace-1", {
        defaultDurationHours: 1.3,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
