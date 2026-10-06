import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase, migrate } from '../../apps/api/database.ts';
import { service } from '../../apps/api/service.ts';

test('paged child export keeps every observation and life action in the existing format', { timeout: 45000 }, async () => {
  const db = await openDatabase('memory://');
  try {
    await migrate(db);
    const now = Date.parse('2026-10-06T12:00:00Z'), api = service(db, () => now);
    const auth = await api.setup({ name: 'Paged export ' + randomUUID().slice(0, 8), password: 'synthetic-export-password', timezone: 'UTC', locale: 'en', acknowledgedLocalUse: true });
    const parent = (await api.authenticate(auth.value))!;
    const child = await api.addChild(parent, { alias: 'Synthetic child', ageBand: '9-11', locale: 'en', localConfirmation: true });
    const space = await api.lifeSpace(parent, child.id);
    await api.createLifeGoal(parent, child.id, { intent: 'suggest', contentHash: space.content.hash, templateId: space.templates[0].id, support: 'ask-first' }, randomUUID());
    for (let index = 0; index < 205; index++) {
      await api.observe(parent, child.id, { task: 'search', context: 'packing', prompts: index % 3, childChoice: index % 2 === 0 }, randomUUID());
    }
    const regular = JSON.parse(JSON.stringify(await api.exportChild(parent, child.id)));
    const chunks: string[] = [];
    await api.exportChildToSink(parent, child.id, async chunk => { chunks.push(chunk); });
    const paged = JSON.parse(chunks.join(''));
    assert.equal(paged.observations.length, 205);
    assert.equal(paged.life.goals.length, 1);
    assert.equal(paged.life.actions.length, 1);
    assert.deepEqual(paged, regular);
  } finally { await db.close(); }
});
