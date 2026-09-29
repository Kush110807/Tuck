import { describe, expect, it } from 'vitest';
import { MemoryWebLocalDatabase, WEB_LOCAL_SCHEMA_VERSION, WebLocalRepository } from '../../src/web/WebLocalRepository';

function makeRepo(database = new MemoryWebLocalDatabase()) {
  return { database, repository: new WebLocalRepository(database) };
}

describe('competition WebLocalRepository', () => {
  it('initializes schema metadata and seeds demo content exactly once', async () => {
    const { database, repository } = makeRepo();
    await repository.initialize();
    const first = await repository.snapshot();
    expect(first.schemaVersion).toBe(WEB_LOCAL_SCHEMA_VERSION);
    expect(first.seeded).toBe(true);
    expect(first.items).toHaveLength(3);
    expect(first.collections.map(value => value.name)).toContain('Ideas');
    await repository.deleteItem('seed-welcome');
    const reopened = new WebLocalRepository(database);
    await reopened.initialize();
    expect((await reopened.snapshot()).items.some(value => value.id === 'seed-welcome')).toBe(false);
  });

  it('persists note, link, edits, tags, pin, archive and restore across reopen', async () => {
    const { database, repository } = makeRepo();
    await repository.initialize();
    const note = await repository.createNote('Competition ideas', 'First draft', ['research']);
    const link = await repository.createLink('Reference', 'https://example.com', ['reading']);
    await repository.patchItem(note.id, { title: 'Final competition ideas', pinned: true, archived: true, tags: ['research', 'product'] });
    const reopened = new WebLocalRepository(database);
    await reopened.initialize();
    let snapshot = await reopened.snapshot();
    const saved = snapshot.items.find(value => value.id === note.id)!;
    expect(saved.title).toBe('Final competition ideas');
    expect(saved.tags).toEqual(['research', 'product']);
    expect(saved.pinned).toBe(true);
    expect(saved.archived).toBe(true);
    expect(snapshot.items.some(value => value.id === link.id)).toBe(true);
    await reopened.patchItem(note.id, { archived: false });
    snapshot = await reopened.snapshot();
    expect(snapshot.items.find(value => value.id === note.id)?.archived).toBe(false);
  });

  it('creates, renames and deletes Collections while unfiling Items', async () => {
    const { repository } = makeRepo();
    await repository.initialize();
    const collection = await repository.createCollection('Research');
    const note = await repository.createNote('Paper', 'Read later', [], collection.id);
    const renamed = await repository.renameCollection(collection.id, 'Reading');
    expect(renamed.name).toBe('Reading');
    await repository.deleteCollection(collection.id);
    const snapshot = await repository.snapshot();
    expect(snapshot.collections.some(value => value.id === collection.id)).toBe(false);
    expect(snapshot.items.find(value => value.id === note.id)?.collectionId).toBeNull();
  });

  it('persists image Blob data, replacement and hard-delete cleanup', async () => {
    const { repository } = makeRepo();
    await repository.initialize();
    const firstBlob = new Blob(['first-image'], { type: 'image/png' });
    const item = await repository.createImage(firstBlob, 'first.png', 'Visual');
    const firstId = item.imageId!;
    const firstUrl = await repository.imageUrl(firstId);
    expect(firstUrl).toMatch(/^blob:/);
    const secondBlob = new Blob(['second-image'], { type: 'image/jpeg' });
    const replaced = await repository.replaceImage(item.id, secondBlob, 'second.jpg');
    expect(replaced.imageId).not.toBe(firstId);
    expect(await repository.imageUrl(firstId)).toBeNull();
    expect(await repository.imageUrl(replaced.imageId!)).toMatch(/^blob:/);
    const reopened = new WebLocalRepository(database);
    await reopened.initialize();
    expect(await reopened.imageUrl(replaced.imageId!)).toMatch(/^blob:/);
    expect((await reopened.snapshot()).items.some(value => value.id === item.id)).toBe(true);
    await reopened.deleteItem(item.id);
    expect(await reopened.imageUrl(replaced.imageId!)).toBeNull();
    expect((await reopened.snapshot()).items.some(value => value.id === item.id)).toBe(false);
  });
});
