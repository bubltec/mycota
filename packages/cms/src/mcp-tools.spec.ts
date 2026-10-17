import { McpServer } from '@bubltec/mycota-mcp';
import { describe, expect, it } from 'vitest';
import { ContentService } from './content.service.js';
import { registry } from './fixture.testing.js';
import { cmsTools } from './mcp-tools.js';
import { InMemoryContentStore } from './store.js';

function setup() {
  const reg = registry();
  const content = new ContentService(new InMemoryContentStore(reg), reg);
  const tools = cmsTools(content);
  const server = new McpServer({ serverInfo: { name: 't', version: '1' }, instructions: '', tools });
  let id = 0;
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = (await server.handleBody({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }, 'a@x.com (mcp)')) as any;
    return { ...res.result, data: res.result.isError ? res.result.content[0].text : res.result.structuredContent };
  };
  return { call, tools, content };
}

describe('cmsTools', () => {
  it('generates only the operations each entity opts into, with shared tools', () => {
    const names = setup().tools.map((t) => t.definition.name);
    expect(names).toEqual(['get_post', 'create_post', 'update_post', 'publish_post', 'add_comment', 'pin_post', 'unpin_post', 'delete_draft', 'set_status']);
  });

  it('builds schemas from the DTO decorators and the entity’s docs', () => {
    const create = setup().tools.find((t) => t.definition.name === 'create_post')!.definition;
    expect(create.description).toBe('Write a post, as a draft.');
    const schema = create.inputSchema as any;
    expect(schema.properties.title).toMatchObject({ type: 'string', minLength: 2, maxLength: 80, description: 'The headline.' });
    expect(schema.properties.status).toBeUndefined();
    expect(schema.required.sort()).toEqual(['body', 'title']);
    expect((setup().tools.find((t) => t.definition.name === 'add_comment')!.definition.inputSchema as any).required).toEqual(['postId', 'text']);
    expect((setup().tools.find((t) => t.definition.name === 'update_post')!.definition.inputSchema as any).required).toEqual(['postId']);
  });

  it('creates drafts attributed to the caller, whatever status the caller asks for', async () => {
    const { call, content } = setup();
    const created = await call('create_post', { title: 'Hello world', body: 'b' });
    expect(created.data).toMatchObject({ id: 'hello-world', status: 'draft', updatedBy: 'a@x.com (mcp)' });
    // `status` never comes from a tool call: it is ignored, and the item is still a draft.
    const forced = await call('create_post', { title: 'Other', body: 'b', status: 'published' });
    expect(forced.data).toMatchObject({ id: 'other', status: 'draft' });
    expect((await content.index(true)).all('post')).toHaveLength(2);
  });

  it('validates arguments with the CMS’s own rules, naming every problem', async () => {
    const { call } = setup();
    const bad = await call('create_post', { title: 'x', body: 'b'.repeat(501) });
    expect(bad.isError).toBe(true);
    expect(bad.data).toMatch(/title/);
    expect(bad.data).toMatch(/body/);
    expect((await call('get_post', { postId: 'nope' })).isError).toBe(true);
  });

  it('updates only the fields passed', async () => {
    const { call } = setup();
    await call('create_post', { title: 'Hello world', body: 'keep', tags: ['a'] });
    const updated = await call('update_post', { postId: 'hello-world', title: 'Hello there' });
    expect(updated.data).toMatchObject({ title: 'Hello there', body: 'keep', tags: ['a'] });
  });

  it('adds children as drafts, and returns the parent’s refreshed view', async () => {
    const { call } = setup();
    await call('create_post', { title: 'Hello world', body: 'b' });
    const res = await call('add_comment', { postId: 'hello-world', text: 'nice' });
    expect(res.data.comments).toHaveLength(1);
    expect(res.data.comments[0]).toMatchObject({ status: 'draft' });
  });

  it('publishes with cascade options, and sets status in bulk', async () => {
    const { call } = setup();
    await call('create_post', { title: 'Hello world', body: 'b' });
    await call('add_comment', { postId: 'hello-world', text: 'nice' });
    await call('pin_post', { postId: 'hello-world' });
    const published = await call('publish_post', { postId: 'hello-world' });
    expect(published.data.status).toBe('published');
    expect(published.data.comments[0].status).toBe('published');
    expect((await call('set_status', { status: 'draft', items: [{ type: 'post', id: 'hello-world' }] })).data).toEqual({ updated: 1 });
    expect((await call('set_status', { status: 'draft', items: [{ type: 'nope', id: 'x' }] })).isError).toBe(true);
  });

  it('deletes drafts only, and unlinks by its own id argument', async () => {
    const { call } = setup();
    await call('create_post', { title: 'Hello world', body: 'b' });
    const pin = await call('pin_post', { postId: 'hello-world' });
    await call('publish_post', { postId: 'hello-world' });
    const refused = await call('delete_draft', { type: 'post', id: 'hello-world' });
    expect(refused.isError).toBe(true);
    expect(refused.data).toMatch(/published/);
    expect((await call('delete_draft', { type: 'nope', id: 'x' })).isError).toBe(true);
    expect((await call('unpin_post', { pinId: pin.data.id })).data).toEqual({ deleted: pin.data.id });
  });
});
