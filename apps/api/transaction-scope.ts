import { AsyncLocalStorage } from 'node:async_hooks';
import type { Database, Queryable } from './database.ts';

// Service operations compose smaller transaction helpers. An authenticated
// operation must keep those helpers inside its identity/locking boundary.
// Nested helpers join the outer transaction; they do not create savepoints.
export function transactionScope(source: Database): Database {
  const active = new AsyncLocalStorage<Queryable>();
  return {
    query: (sql, params) => (active.getStore() ?? source).query(sql, params),
    transaction: action => {
      const current = active.getStore();
      return current ? action(current) : source.transaction(tx => active.run(tx, () => action(tx)));
    },
    ...(source.context ? { context: source.context.bind(source) } : {}),
    close: () => source.close(),
  };
}
