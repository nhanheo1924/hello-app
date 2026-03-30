import { WorkspaceRole } from "@prisma/client";
import { IsEmail, IsEnum } from "class-validator";

export class AddMemberByEmailDto {
  @IsEmail()
  email!: string;

  @IsEnum(WorkspaceRole)
  role!: WorkspaceRole;
}
