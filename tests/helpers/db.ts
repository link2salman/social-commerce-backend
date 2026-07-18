import { sequelize } from '@config/db';
import { tableNames } from '@utils/modelAlias';

// Reset the schema between test files. Driven off `utils/modelAlias.tableNames`
// (the canonical table-name registry) so a new domain table is covered the
// moment it is registered there — no second list to keep in sync.
//
// One TRUNCATE ... CASCADE for all of them: it is a single statement, resets
// every FK-linked child row, and — unlike DELETE — leaves no dead tuples for
// autovacuum. `users` is paranoid (soft-delete), so DESTROY-style cleanup would
// leave rows behind and break the partial unique indexes on the next signup;
// TRUNCATE genuinely empties it.
export const ALL_TABLES: readonly string[] = Object.values(tableNames);

const quoted = ALL_TABLES.map(name => `"${name}"`).join(', ');

export const truncateAll = async (): Promise<void> => {
  await sequelize.query(
    `TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE;`
  );
};
