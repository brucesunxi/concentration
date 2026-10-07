import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase, migrate } from '../../apps/api/database.ts';
import { service } from '../../apps/api/service.ts';
import { TEST_ENVIRONMENT } from '../../packages/task-engine/index.ts';
import { completeEvents } from './fixtures.ts';

test('paged child export preserves observations, events, goals and consent records', { timeout: 45000 }, async () => {
  const db = await openDatabase('memory://');
  try {
    await migrate(db);
    let snapshotExports = 0;
    const trackedDb = { ...db, transaction: <T>(fn: Parameters<typeof db.transaction<T>>[0], options?: { repeatableRead?: boolean }) => {
      if (options?.repeatableRead) snapshotExports++;
      return db.transaction(fn, options);
    } };
    let now = Date.parse('2026-10-06T12:00:00Z');
    const api = service(trackedDb, () => now), name = 'Paged export ' + randomUUID().slice(0, 8), password = 'synthetic-export-password';
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
    // The two consent collections can contain many records with identical
    // timestamps. Exercise their page boundary without exposing proof hashes.
    await db.query(`INSERT INTO local_confirmations(id,family_id,child_id,purpose,version,acknowledged_at,withdrawn_at)
      SELECT ('00000000-0000-4000-8000-'||lpad(to_hex(n),12,'0'))::uuid,$1,$2,'synthetic-export-'||n,'1',
        '2026-10-01T00:00:00Z'::timestamptz+(n%2)*interval '1 microsecond',
        CASE WHEN n%3=0 THEN '2026-10-02T00:00:00Z'::timestamptz ELSE NULL END
      FROM generate_series(1,205) AS n`, [parent.family_id, child.id]);
    await db.query(`INSERT INTO guardian_consents(id,family_id,child_id,owner_member_id,provider,verification_ref_hash,country,age_band,locale,purpose,
        notice_version,notice_sha256,release_scope_identity,verified_at,granted_at,expires_at,withdrawn_at)
      SELECT ('00000000-0000-4000-8000-'||lpad(to_hex(n),12,'0'))::uuid,$1,$2,$3,'synthetic-audit',lpad(to_hex(n),64,'0'),
        'ZZ','9-11','en','family-practice','synthetic-notice',repeat('a',64),'local-development',
        '2026-10-01T00:00:00Z'::timestamptz,
        '2026-10-01T00:00:00Z'::timestamptz+(n%2)*interval '1 microsecond',
        '2027-10-01T00:00:00Z'::timestamptz,
        CASE WHEN n%3=0 THEN '2026-10-02T00:00:00Z'::timestamptz ELSE NULL END
      FROM generate_series(1,205) AS n`, [parent.family_id, child.id, parent.member_id]);
    const regular = JSON.parse(JSON.stringify(await api.exportChild(parent, child.id)));
    const chunks: string[] = [];
    await api.exportChildToSink(parent, child.id, async chunk => { chunks.push(chunk); });
    const paged = JSON.parse(chunks.join(''));
    assert.equal(paged.observations.length, 205);
    assert.ok(paged.events.length > 200);
    assert.equal(paged.life.goals.length, 206);
    assert.equal(paged.life.actions.length, 412);
    assert.equal(paged.confirmations.length, 206);
    assert.equal(paged.verifiedConsents.length, 205);
    assert.equal(chunks.join('').includes('verification_ref_hash'), false);
    assert.deepEqual(paged, regular);
    assert.equal(snapshotExports, 2, 'both export formats must hold one repeatable snapshot across all sections');
    const isolation = await db.transaction(async tx => (await tx.query<{transaction_isolation:string}>('SHOW transaction_isolation')).rows[0].transaction_isolation, { repeatableRead: true });
    assert.equal(isolation, 'repeatable read');
  } finally { await db.close(); }
});
