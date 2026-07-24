'use strict';

/**
 * Brute-force hardening for the password-reset OTP. A 6-digit code lives in a
 * 10⁶ space for up to 10 minutes; the only prior throttle was the per-IP rate
 * limiter, which a rotating-IP attacker sidesteps. `attempts` counts failed
 * verifications against a live code; the service invalidates the code once it
 * crosses the cap, so a targeted email cannot be brute-forced within the window.
 *
 * Additive and safe on populated data: NOT NULL with a default backfills every
 * existing row to 0 in the same statement.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('password_reset_codes', 'attempts', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('password_reset_codes', 'attempts');
  },
};
