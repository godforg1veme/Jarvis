const assert = require('node:assert/strict');
const test = require('node:test');
const { OperationsRepository } = require('../src/operations/repositories/operationsRepository');
const { RollupWorker } = require('../src/operations/collectors/rollupWorker');

test('operations retention deletes only bounded age or quota scoped batches', async () => {
  const sql = []; const repository = new OperationsRepository({ async query(statement) { sql.push(statement); return { rowCount: 0 }; } });
  await repository.applyRetention();
  assert.equal(sql.length, 11);
  assert.ok(sql.some((statement) => statement.includes('268435456')));
  assert.ok(sql.some((statement) => statement.includes('10737418240')));
  assert.ok(sql.some((statement) => statement.includes('vpn_supervisor_runs') && statement.includes("completed_at < now()-interval '60 days'")));
  assert.ok(sql.every((statement) => /LIMIT [1-9]/.test(statement)));
  assert.doesNotMatch(sql.join('\n'), /state='open'/);
});

test('rollup worker does not overlap its own runs', async () => {
  let calls = 0; let release;
  const worker = new RollupWorker({ repository: { rollupMetrics: () => { calls += 1; return new Promise((resolve) => { release = resolve; }); } } });
  const first = worker.runOnce(); const second = worker.runOnce();
  assert.equal(calls, 1); release(); await first; await second;
});
