import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ContentService } from './content.service.js';
import { registry } from './fixture.testing.js';
import { InMemoryContentStore } from './store.js';

function setup() {
  const reg = registry();
  const store = new InMemoryContentStore(reg);
  const content = new ContentService(store, reg, { cacheTtlMs: 60_000 });
  return { content, store, reg };
}

async function seed() {
  const s = setup();
  const created = await s.content.create('post', { title: 'Hello world', body: 'b' }, 'a@x.com');
  return { ...s, post: created.item };
}

describe('ContentService', () => {
  it('creates roots as drafts with slug ids, stamps, and presents them', async () => {
    const { content } = setup();
    const { item, result } = await content.create('post', { title: ' Hello world ', body: 'b' }, 'a@x.com');
    expect(item).toMatchObject({ id: 'hello-world', title: 'Hello world', status: 'draft', createdAt: expect.any(String), updatedBy: 'a@x.com' });
    expect(item.publishedAt).toBeUndefined();
    expect(result).toMatchObject({ id: 'hello-world', comments: [] });
    expect((await content.create('post', { title: 'Hello world', body: 'b' }, 'a')).item.id).toBe('hello-world-2');
  });

  it('children need a parent, and take its status unless given one', async () => {
    const { content, post } = await seed();
    await expect(content.create('comment', { text: 'hi' }, 'a')).rejects.toThrow(BadRequestException);
    await expect(content.create('comment', { text: 'hi' }, 'a', 'nope')).rejects.toThrow(NotFoundException);
    const c = (await content.create('comment', { text: ' hi ' }, 'a', post.id)).item;
    expect(c).toMatchObject({ postId: post.id, text: 'hi', status: 'draft' });
    await content.publish('post', post.id, 'a', { includeChildren: false });
    expect((await content.create('comment', { text: 'live' }, 'a', post.id)).item.status).toBe('published');
    expect((await content.create('comment', { text: 'held' }, 'a', post.id)).item.id).toBeTruthy();
    expect((await content.create('comment', { text: 'x', status: 'draft' }, 'a', post.id)).item.status).toBe('draft');
  });

  it('keeps status and merges fields on update, and reads back through the cache-free get', async () => {
    const { content, post } = await seed();
    const updated = (await content.update('post', { id: post.id }, { title: 'Hello', body: 'new' }, 'b@x.com')).item;
    expect(updated).toMatchObject({ id: post.id, title: 'Hello', body: 'new', status: 'draft', createdAt: post.createdAt, updatedBy: 'b@x.com' });
    expect(await content.get('post', post.id)).toMatchObject({ body: 'new' });
    await expect(content.update('post', { id: 'nope' }, { title: 'xx', body: 'b' }, 'a')).rejects.toThrow(NotFoundException);
  });

  it('enforces the spec’s integrity rules', async () => {
    const { content } = await seed();
    await expect(content.create('pin', { postId: 'missing' }, 'a')).rejects.toThrow(/No post/);
  });

  it('publishes an item with its draft children, and what points at it only when asked', async () => {
    const { content, post } = await seed();
    const c = (await content.create('comment', { text: 'hi' }, 'a', post.id)).item;
    const pin = (await content.create('pin', { postId: post.id }, 'a')).item;
    await content.publish('post', post.id, 'a');
    expect((await content.find('post', post.id)).status).toBe('published');
    expect((await content.find('post', post.id)).publishedAt).toEqual(expect.any(String));
    expect((await content.find('comment', c.id)).status).toBe('published');
    expect((await content.find('pin', pin.id)).status).toBe('draft');
    await content.publish('post', post.id, 'a', { includeLinked: true });
    expect((await content.find('pin', pin.id)).status).toBe('published');
    await expect(content.publish('comment', c.id, 'a')).rejects.toThrow(/set_status/);
  });

  it('moves publishedAt only when something becomes published', async () => {
    const { content, post } = await seed();
    await content.setStatus('published', [{ type: 'post', id: post.id }], 'a');
    const first = (await content.find('post', post.id)).publishedAt;
    await content.update('post', { id: post.id }, { title: 'Hello again', body: 'b' }, 'a');
    expect((await content.find('post', post.id)).publishedAt).toBe(first);
    await content.setStatus('draft', [{ type: 'post', id: post.id }], 'a');
    expect((await content.find('post', post.id)).publishedAt).toBe(first);
  });

  it('setStatus fails the whole call on an unknown id or type, and counts only real changes', async () => {
    const { content, post } = await seed();
    await expect(content.setStatus('published', [{ type: 'post', id: post.id }, { type: 'post', id: 'nope' }], 'a')).rejects.toThrow(NotFoundException);
    await expect(content.setStatus('published', [{ type: 'nope', id: 'x' }], 'a')).rejects.toThrow(/Unknown type/);
    expect((await content.find('post', post.id)).status).toBe('draft');
    expect(await content.setStatus('draft', [{ type: 'post', id: post.id }], 'a')).toEqual({ updated: 0 });
    expect(await content.setStatus('published', [{ type: 'post', id: post.id }], 'a')).toEqual({ updated: 1 });
  });

  it('removes an item with everything under it, returning the parent’s refreshed view for a child', async () => {
    const { content, post } = await seed();
    const c1 = (await content.create('comment', { text: 'one' }, 'a', post.id)).item;
    await content.create('comment', { text: 'two' }, 'a', post.id);
    const view = (await content.remove('comment', { id: c1.id, parentId: post.id }, 'a')) as any;
    expect(view.comments).toHaveLength(1);
    expect(await content.remove('post', { id: post.id }, 'a')).toBeUndefined();
    await expect(content.find('post', post.id)).rejects.toThrow(NotFoundException);
    expect((await content.index(true)).all('comment')).toEqual([]);
  });

  it('removeDraft refuses published items', async () => {
    const { content, post } = await seed();
    await content.publish('post', post.id, 'a');
    await expect(content.removeDraft('post', post.id, 'a')).rejects.toThrow(/published/);
    await content.setStatus('draft', [{ type: 'post', id: post.id }], 'a');
    expect(await content.removeDraft('post', post.id, 'a')).toEqual({ deleted: post.id, type: 'post' });
  });

  it('serves reads from the cache until a write, then sees the write', async () => {
    const { content, store, post } = await seed();
    const before = await content.index();
    await store.put('post', { ...post, title: 'sneaky' } as never);
    expect(await content.index()).toBe(before);
    await content.create('post', { title: 'Another', body: 'b' }, 'a');
    expect((await content.index()).all('post')).toHaveLength(2);
  });
});
