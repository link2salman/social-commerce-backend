'use strict';

/**
 * Rewrite the three JSONB payloads that were storing camelCase keys so they
 * match the snake_case wire contract.
 *
 * These columns are passed straight through by their serializers (and accepted
 * straight back by their validators), so store and wire have to agree. Leaving
 * them camelCase would mean a remap in two places per column — serializer out,
 * validator in — which is exactly the kind of quiet drift this alignment is
 * meant to remove.
 *
 *   orders.shipping_address     recipientName → recipient_name
 *                               postalCode    → postal_code
 *   call_records.participants[] avatarUrl     → avatar_url
 *   messages.attachment         productId     → product_id
 *                               videoId       → video_id
 *
 * Each statement is guarded on the OLD key still being present, so re-running is
 * a no-op and rows written after the deploy are left alone.
 */
module.exports = {
  async up(queryInterface) {
    // orders.shipping_address — rename two keys, drop the old ones.
    await queryInterface.sequelize.query(`
      UPDATE orders
      SET shipping_address =
        (shipping_address - 'recipientName' - 'postalCode')
        || jsonb_build_object(
             'recipient_name', shipping_address->'recipientName',
             'postal_code',    shipping_address->'postalCode'
           )
      WHERE shipping_address IS NOT NULL
        AND shipping_address ? 'recipientName';
    `);

    // call_records.participants — an ARRAY of objects, so rebuild it element by
    // element with jsonb_agg over a lateral unnest.
    await queryInterface.sequelize.query(`
      UPDATE call_records c
      SET participants = sub.rebuilt
      FROM (
        SELECT
          r.call_id,
          jsonb_agg(
            (elem - 'avatarUrl')
            || jsonb_build_object('avatar_url', elem->'avatarUrl')
            ORDER BY ord
          ) AS rebuilt
        FROM call_records r,
             LATERAL jsonb_array_elements(r.participants) WITH ORDINALITY AS t(elem, ord)
        WHERE jsonb_typeof(r.participants) = 'array'
          AND jsonb_array_length(r.participants) > 0
          AND r.participants->0 ? 'avatarUrl'
        GROUP BY r.call_id
      ) sub
      WHERE c.call_id = sub.call_id;
    `);

    // messages.attachment — the two id keys are OPTIONAL (a discriminated union
    // on `type`), so only rename the one that is actually present. Writing both
    // unconditionally would materialise nulls for the absent variant and break
    // the union.
    await queryInterface.sequelize.query(`
      UPDATE messages
      SET attachment = (attachment - 'productId')
        || jsonb_build_object('product_id', attachment->'productId')
      WHERE attachment IS NOT NULL AND attachment ? 'productId';
    `);
    await queryInterface.sequelize.query(`
      UPDATE messages
      SET attachment = (attachment - 'videoId')
        || jsonb_build_object('video_id', attachment->'videoId')
      WHERE attachment IS NOT NULL AND attachment ? 'videoId';
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE orders
      SET shipping_address =
        (shipping_address - 'recipient_name' - 'postal_code')
        || jsonb_build_object(
             'recipientName', shipping_address->'recipient_name',
             'postalCode',    shipping_address->'postal_code'
           )
      WHERE shipping_address IS NOT NULL
        AND shipping_address ? 'recipient_name';
    `);

    await queryInterface.sequelize.query(`
      UPDATE call_records c
      SET participants = sub.rebuilt
      FROM (
        SELECT
          r.call_id,
          jsonb_agg(
            (elem - 'avatar_url')
            || jsonb_build_object('avatarUrl', elem->'avatar_url')
            ORDER BY ord
          ) AS rebuilt
        FROM call_records r,
             LATERAL jsonb_array_elements(r.participants) WITH ORDINALITY AS t(elem, ord)
        WHERE jsonb_typeof(r.participants) = 'array'
          AND jsonb_array_length(r.participants) > 0
          AND r.participants->0 ? 'avatar_url'
        GROUP BY r.call_id
      ) sub
      WHERE c.call_id = sub.call_id;
    `);

    await queryInterface.sequelize.query(`
      UPDATE messages
      SET attachment = (attachment - 'product_id')
        || jsonb_build_object('productId', attachment->'product_id')
      WHERE attachment IS NOT NULL AND attachment ? 'product_id';
    `);
    await queryInterface.sequelize.query(`
      UPDATE messages
      SET attachment = (attachment - 'video_id')
        || jsonb_build_object('videoId', attachment->'video_id')
      WHERE attachment IS NOT NULL AND attachment ? 'video_id';
    `);
  },
};
