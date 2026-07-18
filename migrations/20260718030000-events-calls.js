'use strict';

/**
 * Phase 5 schema — events (+ attendees) and the call log. attendee_count is a
 * denormalized counter (matches the app's mock, where a big base count is shown
 * and RSVP nudges it ±1); the attendees table tracks WHO is going (isAttending).
 * Call records are immutable snapshots — the peer's identity is frozen at call
 * time, so peer_username/avatar are stored inline.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { UUID, TEXT, STRING, INTEGER, DOUBLE, BOOLEAN, DATE, ENUM } =
      Sequelize;
    const uuidPk = {
      type: UUID,
      primaryKey: true,
      allowNull: false,
      defaultValue: Sequelize.literal('gen_random_uuid()'),
    };
    const now = Sequelize.literal('CURRENT_TIMESTAMP');
    const userFk = (allowNull, onDelete) => ({
      type: UUID,
      allowNull,
      references: { model: 'users', key: 'user_id' },
      onDelete,
      onUpdate: 'CASCADE',
    });

    await queryInterface.sequelize.transaction(async transaction => {
      const opts = { transaction };

      // ── events ─────────────────────────────────────────────────────────────
      await queryInterface.createTable(
        'events',
        {
          event_id: uuidPk,
          host_id: userFk(false, 'CASCADE'),
          title: { type: STRING(200), allowNull: false },
          description: { type: TEXT, allowNull: false, defaultValue: '' },
          cover_url: { type: TEXT, allowNull: false },
          starts_at: { type: DATE, allowNull: false },
          ends_at: { type: DATE, allowNull: true },
          location_name: { type: STRING(200), allowNull: false },
          price_cents: { type: INTEGER, allowNull: false, defaultValue: 0 },
          currency: { type: STRING(3), allowNull: false, defaultValue: 'USD' },
          latitude: { type: DOUBLE, allowNull: true },
          longitude: { type: DOUBLE, allowNull: true },
          attendee_count: { type: INTEGER, allowNull: false, defaultValue: 0 },
          created_at: { type: DATE, allowNull: false, defaultValue: now },
          updated_at: { type: DATE, allowNull: false, defaultValue: now },
        },
        opts
      );
      await queryInterface.addIndex('events', ['starts_at'], opts);
      await queryInterface.addIndex('events', ['host_id'], opts);

      // ── event_attendees ────────────────────────────────────────────────────
      await queryInterface.createTable(
        'event_attendees',
        {
          id: uuidPk,
          event_id: {
            type: UUID,
            allowNull: false,
            references: { model: 'events', key: 'event_id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          user_id: userFk(false, 'CASCADE'),
          has_ticket: { type: BOOLEAN, allowNull: false, defaultValue: false },
          created_at: { type: DATE, allowNull: false, defaultValue: now },
        },
        opts
      );
      await queryInterface.addIndex('event_attendees', ['event_id', 'user_id'], {
        unique: true,
        name: 'event_attendees_unique',
        ...opts,
      });
      await queryInterface.addIndex('event_attendees', ['user_id'], opts);

      // ── call_records ───────────────────────────────────────────────────────
      await queryInterface.createTable(
        'call_records',
        {
          call_id: uuidPk,
          owner_id: userFk(false, 'CASCADE'),
          // Frozen snapshot of the peer's user id (no FK) — the record is
          // historical and must survive the peer being removed/renamed.
          peer_id: { type: UUID, allowNull: false },
          peer_username: { type: STRING(24), allowNull: false },
          peer_avatar_url: { type: TEXT, allowNull: true },
          direction: { type: ENUM('incoming', 'outgoing'), allowNull: false },
          is_video: { type: BOOLEAN, allowNull: false, defaultValue: false },
          outcome: {
            type: ENUM('completed', 'missed', 'declined'),
            allowNull: false,
          },
          started_at: { type: DATE, allowNull: false },
          duration_sec: { type: INTEGER, allowNull: false, defaultValue: 0 },
          created_at: { type: DATE, allowNull: false, defaultValue: now },
        },
        opts
      );
      await queryInterface.addIndex(
        'call_records',
        ['owner_id', 'started_at'],
        opts
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async transaction => {
      const opts = { transaction };
      await queryInterface.dropTable('call_records', opts);
      await queryInterface.dropTable('event_attendees', opts);
      await queryInterface.dropTable('events', opts);
      await queryInterface.sequelize.query(
        'DROP TYPE IF EXISTS "enum_call_records_direction";',
        opts
      );
      await queryInterface.sequelize.query(
        'DROP TYPE IF EXISTS "enum_call_records_outcome";',
        opts
      );
    });
  },
};
