import 'reflect-metadata';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUrl, Length, Matches, MaxLength, ValidateNested } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { dto } from './args.js';
import { dtoKeys, dtoSchema } from './dto-schema.js';

class PointDto {
  @IsString() @MaxLength(500) text!: string;
}
class ThingDto {
  @IsString() @Length(2, 40) name!: string;
  @IsIn(['a', 'b']) kind!: string;
  @IsOptional() @IsBoolean() flag?: boolean;
  @IsOptional() @IsUrl() url?: string;
  @IsOptional() @Matches(/^\d{4}$/) year?: string;
  @IsArray() @ArrayMaxSize(3) @MaxLength(10, { each: true }) tags!: string[];
  @ValidateNested({ each: true }) @Type(() => PointDto) points!: PointDto[];
  @IsString() status!: string;
}

describe('dtoSchema', () => {
  it('reads types, bounds, enums and required-ness off the decorators', () => {
    const schema = dtoSchema(ThingDto, { omit: ['status'], docs: { name: 'The name.', 'points.text': 'Point text.' } }) as any;
    expect(schema.properties.name).toEqual({ type: 'string', minLength: 2, maxLength: 40, description: 'The name.' });
    expect(schema.properties.kind).toEqual({ type: 'string', enum: ['a', 'b'] });
    expect(schema.properties.flag).toEqual({ type: 'boolean' });
    expect(schema.properties.url).toMatchObject({ format: 'uri' });
    expect(schema.properties.year).toMatchObject({ pattern: '^\\d{4}$' });
    expect(schema.properties.tags).toEqual({ type: 'array', items: { type: 'string', maxLength: 10 }, maxItems: 3 });
    expect(schema.properties.points.items.properties.text).toEqual({ type: 'string', maxLength: 500, description: 'Point text.' });
    expect(schema.properties.status).toBeUndefined();
    expect(schema.required.sort()).toEqual(['kind', 'name', 'points', 'tags']);
  });

  it('supports defaults (not required) and partial updates (nothing required)', () => {
    expect((dtoSchema(ThingDto, { defaults: ['kind'] }) as any).required).not.toContain('kind');
    expect((dtoSchema(ThingDto, { partial: true }) as any).required).toBeUndefined();
  });

  it('lists the DTO keys', () => {
    expect(dtoKeys(ThingDto).sort()).toEqual(['flag', 'kind', 'name', 'points', 'status', 'tags', 'url', 'year']);
  });
});

describe('dto()', () => {
  it('validates with the same decorators, naming every problem', async () => {
    await expect(dto(ThingDto, { name: 'x', kind: 'z', tags: [], points: [{ text: 1 }], status: 's' })).rejects.toThrow(/name must be longer|kind must be one of|text must be a string/);
  });
  it('rejects unknown fields and accepts a valid input', async () => {
    await expect(dto(ThingDto, { name: 'ok', kind: 'a', tags: [], points: [], status: 's', extra: 1 })).rejects.toThrow(/extra/);
    await expect(dto(ThingDto, { name: 'ok', kind: 'a', tags: [], points: [], status: 's', flag: undefined })).resolves.toBeInstanceOf(ThingDto);
  });
});
