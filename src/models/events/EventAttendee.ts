import { DataTypes, type Model, type Optional } from 'sequelize';
import { sequelize } from '@config/db';
import { tableNames } from '@utils/modelAlias';

// One row per (event, attendee). A free RSVP and a paid ticket both create a
// row; has_ticket distinguishes them. isAttending = a row exists for the viewer.
export interface EventAttendeeAttributes {
  id: string;
  event_id: string;
  user_id: string;
  has_ticket: boolean;
  payment_intent_id: string | null;
  created_at: Date;
}

export type EventAttendeeCreationAttributes = Optional<
  EventAttendeeAttributes,
  'id' | 'has_ticket' | 'payment_intent_id' | 'created_at'
>;

export interface EventAttendeeModel
  extends Model<EventAttendeeAttributes, EventAttendeeCreationAttributes>,
    EventAttendeeAttributes {}

const EventAttendee = sequelize.define<EventAttendeeModel>(
  'EventAttendee',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    event_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: tableNames.Event, key: 'event_id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: tableNames.User, key: 'user_id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    has_ticket: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    payment_intent_id: { type: DataTypes.STRING(255), allowNull: true },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    tableName: tableNames.EventAttendee,
    timestamps: false,
    indexes: [
      { unique: true, fields: ['event_id', 'user_id'] },
      { fields: ['user_id'] },
    ],
  }
);

export default EventAttendee;
