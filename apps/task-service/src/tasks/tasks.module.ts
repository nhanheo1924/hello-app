import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ProjectsController } from "./projects.controller";
import { TasksController } from "./tasks.controller";
import { TasksService } from "./tasks.service";
import { WorkspacesController } from "./workspaces.controller";

@Module({
  imports: [AuthModule],
  controllers: [WorkspacesController, ProjectsController, TasksController],
  providers: [TasksService],
})
export class TasksModule {}
