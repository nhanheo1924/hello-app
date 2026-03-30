import { Transform } from "class-transformer";
import { IsBoolean, IsOptional } from "class-validator";
import { PaginationQueryDto } from "./pagination-query.dto";

export class NotificationQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }
    if (value === true || value === "true" || value === "1") {
      return true;
    }
    if (value === false || value === "false" || value === "0") {
      return false;
    }
    return value;
  })
  @IsBoolean()
  unreadOnly?: boolean;
}
