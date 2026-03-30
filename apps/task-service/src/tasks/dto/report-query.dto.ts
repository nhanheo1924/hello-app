import { IsEnum, IsISO8601, IsOptional } from "class-validator";

export enum ReportGroupBy {
  DAY = "day",
  WEEK = "week",
}

export enum ReportBreakdownDimension {
  ASSIGNEE = "assignee",
  PROJECT = "project",
  STATUS = "status",
  LABEL = "label",
}

export enum ReportExportType {
  SUMMARY = "summary",
  TASKS = "tasks",
  ACTIVITY = "activity",
}

export class ReportOverviewQueryDto {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @IsEnum(ReportGroupBy)
  groupBy?: ReportGroupBy;
}

export class ReportBreakdownQueryDto {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsEnum(ReportBreakdownDimension)
  dimension!: ReportBreakdownDimension;
}

export class ReportExportQueryDto {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @IsEnum(ReportExportType)
  type?: ReportExportType;
}
