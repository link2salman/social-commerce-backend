'use strict';

/**
 * Report review workflow. `reports` was insert-only — rows landed and nothing
 * consumed them. These columns give a report a lifecycle a moderator can drive:
 * status (pending → actioned/dismissed), who resolved it, when, and a note.
 *
 * Safe on populated data: status is NOT NULL with a 'pending' default, so every
 * existing report backfills to pending (which is exactly correct — none have
 * been reviewed). The rest are nullable.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { UUID, DATE, TEXT, ENUM } = Sequelize;

    await queryInterface.sequelize.transaction(async transaction => {
      const opts = { transaction };

      await queryInterface.addColumn(
        'reports',
        'status',
        {
          type: ENUM('pending', 'actioned', 'dismissed'),
          allowNull: false,
          defaultValue: 'pending',
        },
        opts
      );
      await queryInterface.addColumn(
        'reports',
        'reviewed_by',
        {
          type: UUID,
          allowNull: true,
          references: { model: 'users', key: 'user_id' },
          onDelete: 'SET NULL',
          onUpdate: 'CASCADE',
        },
        opts
      );
      await queryInterface.addColumn(
        'reports',
        'reviewed_at',
        { type: DATE, allowNull: true },
        opts
      );
      await queryInterface.addColumn(
        'reports',
        'resolution_note',
        { type: TEXT, allowNull: true },
        opts
      );

      // The queue query filters by status; the resolve-all path filters by
      // (target, status). One partial index keeps "pending work" cheap.
      await queryInterface.sequelize.query(
        'CREATE INDEX reports_pending ON reports (created_at, report_id) WHERE status = \'pending\';',
        opts
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      const opts = { transaction };
      await queryInterface.sequelize.query('DROP INDEX IF EXISTS reports_pending;', opts);
      await queryInterface.removeColumn('reports', 'resolution_note', opts);
      await queryInterface.removeColumn('reports', 'reviewed_at', opts);
      await queryInterface.removeColumn('reports', 'reviewed_by', opts);
      await queryInterface.removeColumn('reports', 'status', opts);
      await queryInterface.sequelize.query(
        'DROP TYPE IF EXISTS "enum_reports_status";',
        opts
      );
    });
  },
};
