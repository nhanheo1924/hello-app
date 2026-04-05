import { Transform } from 'class-transformer';
import { IsArray, IsUUID } from 'class-validator';

function normalizeScalarInput(value: unknown): string {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }

  return '';
}

function normalizeIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => normalizeScalarInput(item).split(','))
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  return normalizeScalarInput(value)
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
