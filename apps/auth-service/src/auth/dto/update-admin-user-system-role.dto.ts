import { SystemRole } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateAdminUserSystemRoleDto {
  @IsEnum(SystemRole)
  systemRole!: SystemRole;
}

