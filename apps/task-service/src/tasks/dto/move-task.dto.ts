import { Type } from "class-transformer";
import { IsInt, IsUUID, Min } from "class-validator";

export class MoveTaskDto {
  @IsUUID()
  columnId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  orderIndex!: number;
}
