import { ProjectViewType } from "@prisma/client";
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

export class UpdateProjectSettingsDto {
  @IsOptional()
  @IsEnum(ProjectViewType)
  defaultView?: ProjectViewType;

  @IsOptional()
  @IsBoolean()
  allowMemberInvite?: boolean;

  @IsOptional()
  @IsBoolean()
  allowComment?: boolean;

  @IsOptional()
  @IsBoolean()
  allowViewerComment?: boolean;

  @IsOptional()
  @IsBoolean()
  allowTaskReorder?: boolean;

  @IsOptional()
  @IsBoolean()
  allowTaskDeleteByMember?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  taskPrefix?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  themeColor?: string;

  @IsOptional()
  @IsBoolean()
  isPrivateByDefault?: boolean;
}
