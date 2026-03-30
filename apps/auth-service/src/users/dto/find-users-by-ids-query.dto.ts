import { Transform } from 'class-transformer';
import { IsArray, IsUUID } from 'class-validator';

function normalizeIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => String(item || '').split(','))
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export class FindUsersByIdsQueryDto {
  @Transform(({ value }) => normalizeIds(value))
  @IsArray()
  @IsUUID('4', { each: true })
  ids!: string[];
}
