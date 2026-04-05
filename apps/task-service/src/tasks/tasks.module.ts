import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { GovernanceController } from "./governance.controller";
import { InternalAdminController } from "./internal-admin.controller";
import { NotificationsController } from "./notifications.controller";
import { ProjectsController } from "./projects.controller";
import { TasksController } from "./tasks.controller";
import { TasksService } from "./tasks.service";
import { WorkspacesController } from "./workspaces.controller";

@Module({
  imports: [AuthModule],
  controllers: [
    WorkspacesController,
    ProjectsController,
    TasksController,
    NotificationsController,
    GovernanceController,
    InternalAdminController,
  ],
  providers: [TasksService],
})
export class TasksModule {}
