'use strict';

/**
 * Group-call history.
 *
 * `call_records` was strictly 1:1: owner_id + a FROZEN SNAPSHOT of the single
 * peer (peer_username/peer_avatar_url), so a history row never drifts if that
 * user later renames. Group calls happen in the app today but vanish without a
 * trace; this widens the same row to represent them.
 *
 * The snapshot principle is preserved for EVERY participant: `participants` is
 * a JSONB array of {id, username, avatarUrl} captured at call time — the exact
 * same frozen-at-write shape as peer_*, just N of them. It is deliberately NOT
 * a join table: the snapshot is denormalized BY DESIGN (that's the whole point
 * of freezing it), the list is read far more than it is written, and keeping it
 * inline means listing history stays one indexed query with no join to re-group.
 *
 * Safe on populated data — every step is additive or a constraint RELAXATION:
 *   - is_group / participants are added NOT NULL WITH a default, so existing
 *     rows are backfilled by Postgres in the same statement.
 *   - peer_id / peer_username DROP NOT NULL (widening; never fails on data).
 * An existing 1:1 row therefore keeps working byte-for-byte: is_group=false,
 * participants='[]', peer_* untouched.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { BOOLEAN, JSONB } = Sequelize;

    await queryInterface.sequelize.transaction(async transaction => {
      const opts = { transaction };

      await queryInterface.addColumn(
        'call_records',
        'is_group',
        { type: BOOLEAN, allowNull: false, defaultValue: false },
        opts
      );

      // Frozen snapshots of everyone rung, excluding the owner. '[]' for a 1:1
      // row, where peer_* carries the single other side instead.
      await queryInterface.addColumn(
        'call_records',
        'participants',
        {
          type: JSONB,
          allowNull: false,
          defaultValue: Sequelize.literal(`'[]'::jsonb`),
        },
        opts
      );

      // A group call has no single peer, so the 1:1 snapshot columns become
      // nullable. Relaxing NOT NULL is safe on populated data by definition.
      await queryInterface.changeColumn(
        'call_records',
        'peer_id',
        { type: Sequelize.UUID, allowNull: true },
        opts
      );
      await queryInterface.changeColumn(
        'call_records',
        'peer_username',
        { type: Sequelize.STRING(24), allowNull: true },
        opts
      );

      // Exactly one of the two shapes is populated, enforced in the database so
      // no future writer can produce a row the serializer can't describe.
      await queryInterface.sequelize.query(
        `ALTER TABLE "call_records" ADD CONSTRAINT "call_records_peer_xor_group" CHECK (
           (is_group = false AND peer_id IS NOT NULL AND peer_username IS NOT NULL)
           OR
           (is_group = true AND peer_id IS NULL AND peer_username IS NULL
            AND jsonb_array_length(participants) > 0)
         )`,
        opts
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      const opts = { transaction };

      await queryInterface.sequelize.query(
        'ALTER TABLE "call_records" DROP CONSTRAINT IF EXISTS "call_records_peer_xor_group";',
        opts
      );
      // Group rows cannot be represented by the 1:1 shape being restored, so
      // they are dropped rather than left to violate the NOT NULL below.
      await queryInterface.sequelize.query(
        'DELETE FROM "call_records" WHERE is_group = true;',
        opts
      );
      await queryInterface.removeColumn('call_records', 'participants', opts);
      await queryInterface.removeColumn('call_records', 'is_group', opts);
      await queryInterface.changeColumn(
        'call_records',
        'peer_id',
        { type: queryInterface.sequelize.Sequelize.UUID, allowNull: false },
        opts
      );
      await queryInterface.changeColumn(
        'call_records',
        'peer_username',
        { type: queryInterface.sequelize.Sequelize.STRING(24), allowNull: false },
        opts
      );
    });
  },
};
