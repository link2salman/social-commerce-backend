import { DataTypes, type Model, type Optional } from 'sequelize';
import { sequelize } from '@config/db';
import { tableNames } from '@utils/modelAlias';
import {
  NOTIFICATION_TYPES,
  NOTIFICATION_TARGET_TYPES,
  type NotificationType,
  type NotificationTargetType,
} from '@constants/enums';

// One row in a user's notification feed. The durable counterpart to the FCM
// push fired for the same event — push can be missed, this cannot.
//
// Polymorphic target (target_id has no FK), like Report: the reader resolves
// target_id by target_type. `read_at` null means unread.
export interface NotificationAttributes {
  notification_id: string;
  recipient_id: string;
  /** The user who caused it; null for a system notification or a deleted actor. */
  actor_id: string | null;
  type: NotificationType;
  target_type: NotificationTargetType;
  target_id: string;
  read_at: Date | null;
  created_at: Date;
}

export type NotificationCreationAttributes = Optional<
  NotificationAttributes,
  'notification_id' | 'actor_id' | 'read_at' | 'created_at'
>;

export interface NotificationModel
  extends Model<NotificationAttributes, NotificationCreationAttributes>,
    NotificationAttributes {}

const Notification = sequelize.define<NotificationModel>(
  'Notification',
  {
    notification_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    recipient_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: tableNames.User, key: 'user_id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    actor_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: tableNames.User, key: 'user_id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    },
    type: {
      type: DataTypes.ENUM(...NOTIFICATION_TYPES),
      allowNull: false,
    },
    target_type: {
      type: DataTypes.ENUM(...NOTIFICATION_TARGET_TYPES),
      allowNull: false,
    },
    target_id: { type: DataTypes.UUID, allowNull: false },
    read_at: { type: DataTypes.DATE, allowNull: true },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    tableName: tableNames.Notification,
    timestamps: false,
    indexes: [
      { fields: ['recipient_id', 'created_at', 'notification_id'] },
      { fields: ['recipient_id'], where: { read_at: null } },
      // Mirrors `notifications_message_unread_unique`: at most ONE unread
      // 'message' row per (recipient, conversation). It is what makes the
      // coalescing upsert in notificationService atomic — declared here only for
      // parity with the migration, which is the schema's source of truth.
      {
        name: 'notifications_message_unread_unique',
        unique: true,
        fields: ['recipient_id', 'target_type', 'target_id'],
        where: { type: 'message', read_at: null },
      },
    ],
  }
);

export default Notification;
