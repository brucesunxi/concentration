import { AsyncLocalStorage } from 'node:async_hooks';
import type { Database, Queryable } from './database.ts';

// Service operations compose smaller transaction helpers. An authenticated
// operation must keep those helpers inside its identity/locking boundary.
// Nested helpers join the outer transaction; they do not create savepoints.
export function transactionScope(source: Database): Database {
  const active = new AsyncLocalStorage<{ tx: Queryable; repeatableRead: boolean }>();
  return {
    query: (sql, params) => (active.getStore()?.tx ?? source).query(sql, params),
    transaction: (action, options) => {
      const current = active.getStore();
      if (current) {
        if (options?.repeatableRead && !current.repeatableRead) throw new Error('REPEATABLE_READ_MUST_START_OUTER_TRANSACTION');
        return action(current.tx);
      }
      return source.transaction(tx => active.run({ tx, repeatableRead: !!options?.repeatableRead }, () => action(tx)), options);
    },
    ...(source.context ? { context: source.context.bind(source) } : {}),
    close: () => source.close(),
  };
}
