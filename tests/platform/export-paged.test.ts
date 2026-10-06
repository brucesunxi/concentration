import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase, migrate } from '../../apps/api/database.ts';
import { service } from '../../apps/api/service.ts';
import { TEST_ENVIRONMENT } from '../../packages/task-engine/index.ts';
import { completeEvents } from './fixtures.ts';

test('paged child export keeps every observation and life action in the existing format', { timeout: 45000 }, async () => {
  const db = await openDatabase('memory://');
  try {
    await migrate(db);
    let now = Date.parse('2026-10-06T12:00:00Z');
    const api = service(db, () => now), name = 'Paged export ' + randomUUID().slice(0, 8), password = 'synthetic-export-password';
    const auth = await api.setup({ name, password, timezone: 'UTC', locale: 'en', acknowledgedLocalUse: true });
    let parent = (await api.authenticate(auth.value))!;
    const child = await api.addChild(parent, { alias: 'Synthetic child', ageBand: '9-11', locale: 'en', localConfirmation: true });
    const space = await api.lifeSpace(parent, child.id);
    const firstGoal = (await api.createLifeGoal(parent, child.id, { intent: 'suggest', contentHash: space.content.hash, templateId: space.templates[0].id, support: 'ask-first' }, randomUUID())).goal;
    await api.actLifeGoal(parent, child.id, firstGoal.id, { action: 'stop' }, '"1"', randomUUID());
    for (let index = 0; index < 205; index++) {
      await api.observe(parent, child.id, { task: 'search', context: 'packing', prompts: index % 3, childChoice: index % 2 === 0 }, randomUUID());
    }
    await db.query("UPDATE observations SET created_at=created_at+interval '1 microsecond' WHERE id IN (SELECT id FROM observations WHERE child_id=$1 ORDER BY id LIMIT 100)", [child.id]);
    for (let day = 0; day < 5; day++) {
      const started = await api.start(parent, child.id, { task: 'memory', environment: TEST_ENVIRONMENT, deviceId: randomUUID() }, randomUUID());
      const childAccess = (await api.authenticate(started.auth.value))!, events = completeEvents(started.session.plan);
      await api.append(childAccess, started.session.id, { events });
      await api.finalize(childAccess, started.session.id, { lastSeq: events.length });
      now += 86400000;
      parent = (await api.authenticate((await api.login({ name, password })).value))!;
    }
    for (let index = 0; index < 205; index++) {
      const goal = (await api.createLifeGoal(parent, child.id, { intent: 'suggest', contentHash: space.content.hash, templateId: space.templates[0].id, support: 'space' }, randomUUID())).goal;
      await api.actLifeGoal(parent, child.id, goal.id, { action: 'stop' }, '"1"', randomUUID());
    }
    const regular = JSON.parse(JSON.stringify(await api.exportChild(parent, child.id)));
    const chunks: string[] = [];
    await api.exportChildToSink(parent, child.id, async chunk => { chunks.push(chunk); });
    const paged = JSON.parse(chunks.join(''));
    assert.equal(paged.observations.length, 205);
    assert.ok(paged.events.length > 200);
    assert.equal(paged.life.goals.length, 206);
    assert.equal(paged.life.actions.length, 412);
    assert.deepEqual(paged, regular);
  } finally { await db.close(); }
});
