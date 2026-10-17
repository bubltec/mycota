import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, Length, MaxLength, ValidateNested } from 'class-validator';
import { entityDef } from './entity-def.js';
import { defineEntity } from './entity-spec.js';
import { EntityRegistry } from './registry.js';
import { statusOf } from './status.js';
import { uniqueSlug } from './ids.js';

/** A small blog: posts own comments; a `pin` entity points at a post. Exercises roots, children and cascades. */
export class PostDto {
  @IsString() @Length(2, 80) title!: string;
  @IsString() @MaxLength(500) body!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(5) @MaxLength(20, { each: true }) tags?: string[];
  @IsOptional() @IsIn(['draft', 'published']) status?: 'draft' | 'published';
}
export class CommentDto {
  @IsString() @Length(1, 200) text!: string;
  @IsOptional() @IsIn(['draft', 'published']) status?: 'draft' | 'published';
}
export class PinDto {
  @IsString() postId!: string;
  @IsOptional() @IsIn(['draft', 'published']) status?: 'draft' | 'published';
}
export class UnusedNested {
  @ValidateNested({ each: true }) @Type(() => CommentDto) items!: CommentDto[];
}

export const postDef = entityDef({ name: 'post' });
export const commentDef = entityDef({ name: 'comment', parent: postDef });
export const pinDef = entityDef({ name: 'pin' });

export const postSpec = defineEntity<any, PostDto>({
  def: postDef,
  dto: PostDto,
  route: 'posts',
  makeId: (input, { index }) => uniqueSlug(input.title, new Set(index.all('post').map((p) => p.id))),
  fields: (input) => ({ title: input.title.trim(), body: input.body, tags: input.tags ?? [] }),
  present: (post, { index }) => ({ ...post, comments: index.childrenOf('comment', post.id) }),
  publish: {
    cascade: (post, { index }, { includeChildren, includeLinked }) => [
      ...(includeChildren ? index.childrenOf('comment', post.id).filter((c) => statusOf(c) === 'draft').map((c) => ({ type: 'comment', id: c.id })) : []),
      ...(includeLinked ? index.all('pin').filter((p) => p.postId === post.id).map((p) => ({ type: 'pin', id: p.id })) : []),
    ],
  },
  mcp: {
    get: true,
    create: { description: 'Write a post, as a draft.' },
    update: true,
    publish: true,
    deleteDraft: true,
    fields: { title: 'The headline.', body: 'The text.' },
  },
});

export const commentSpec = defineEntity<any, CommentDto>({
  def: commentDef,
  dto: CommentDto,
  route: 'comments',
  fields: (input) => ({ text: input.text.trim() }),
  present: (comment, { index }) => postSpec.present!(index.byId('post', comment.postId)!, { index } as never),
  mcp: { create: { name: 'add_comment' }, deleteDraft: true, fields: { text: 'The comment.' } },
});

export const pinSpec = defineEntity<any, PinDto>({
  def: pinDef,
  dto: PinDto,
  route: 'pins',
  fields: (input, { index }) => {
    if (!index.byId('post', input.postId)) throw new BadRequestException(`No post "${input.postId}"`);
    return { postId: input.postId };
  },
  onDelete: () => [],
  mcp: { create: { name: 'pin_post' }, delete: { name: 'unpin_post', idArg: 'pinId' }, deleteDraft: true },
});

export const registry = () => new EntityRegistry([postSpec, commentSpec, pinSpec]);
