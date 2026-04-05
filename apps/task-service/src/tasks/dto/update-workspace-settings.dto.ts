import { IsBoolean, IsIn, IsNumber, IsOptional, Matches, Max, Min } from "class-validator";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class UpdateWorkspaceSettingsDto {
  @IsOptional()
  @Matches(ISO_DATE_PATTERN)
  startDate?: string | null;

  @IsOptional()
  @Matches(ISO_DATE_PATTERN)
  endDate?: string | null;

  @IsOptional()
  @IsIn(["12", "24"])
  hourFormat?: "12" | "24";

  @IsOptional()
  @IsBoolean()
  showWeekends?: boolean;

  @IsOptional()
  @IsIn(["mon", "sun"])
  weekStart?: "mon" | "sun";

  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(12)
  defaultDurationHours?: number;
}
