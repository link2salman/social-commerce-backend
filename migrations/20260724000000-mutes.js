'use strict';

/**
 * Mutes — the soft cousin of blocks. A mute hides the muted user's videos from
 * the muter's feeds (feedService / rankingService) without severing the follow
 * graph and without telling the muted user. Same shape as `blocks`: a directed
 * (muter → muted) edge, unique per pair, self-rows forbidden.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { UUID, DATE } = Sequelize;
    const now = Sequelize.literal('CURRENT_TIMESTAMP');

    await queryInterface.sequelize.transaction(async transaction => {
      const opts = { transaction };

      await queryInterface.createTable(
        'mutes',
        {
          mute_id: {
            type: UUID,
            primaryKey: true,
            allowNull: false,
            defaultValue: Sequelize.literal('gen_random_uuid()'),
          },
          muter_id: {
            type: UUID,
            allowNull: false,
            references: { model: 'users', key: 'user_id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          muted_id: {
            type: UUID,
            allowNull: false,
            references: { model: 'users', key: 'user_id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          created_at: { type: DATE, allowNull: false, defaultValue: now },
        },
        opts
      );

      // One mute per (muter, muted) pair — the toggle is findOrCreate.
      await queryInterface.addIndex('mutes', ['muter_id', 'muted_id'], {
        unique: true,
        name: 'mutes_pair_unique',
        ...opts,
      });
      // "Which of these authors has the viewer muted?" — the feed-exclusion query.
      await queryInterface.addIndex('mutes', ['muter_id'], {
        name: 'mutes_muter',
        ...opts,
      });

      // Self-rows are nonsensical — you cannot mute yourself (mirrors blocks).
      await queryInterface.sequelize.query(
        'ALTER TABLE mutes ADD CONSTRAINT mutes_no_self CHECK (muter_id <> muted_id);',
        opts
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('mutes');
  },
};
