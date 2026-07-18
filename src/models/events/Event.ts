import { DataTypes, type Model, type Optional } from 'sequelize';
import { sequelize } from '@config/db';
import { tableNames } from '@utils/modelAlias';
import { DEFAULT_CURRENCY } from '@constants/enums';

// attendee_count is denormalized (RSVP nudges it ±1); the attendees table tracks
// membership for isAttending. priceCents is minor units (events use priceCents
// on the wire, unlike commerce which uses major-unit dollars).
export interface EventAttributes {
  event_id: string;
  host_id: string;
  title: string;
  description: string;
  cover_url: string;
  starts_at: Date;
  ends_at: Date | null;
  location_name: string;
  price_cents: number;
  currency: string;
  latitude: number | null;
  longitude: number | null;
  attendee_count: number;
  created_at: Date;
  updated_at: Date;
}

export type EventCreationAttributes = Optional<
  EventAttributes,
  | 'event_id'
  | 'description'
  | 'ends_at'
  | 'price_cents'
  | 'currency'
  | 'latitude'
  | 'longitude'
  | 'attendee_count'
  | 'created_at'
  | 'updated_at'
>;

export interface EventModel
  extends Model<EventAttributes, EventCreationAttributes>,
    EventAttributes {}

const Event = sequelize.define<EventModel>(
  'Event',
  {
    event_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    host_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: tableNames.User, key: 'user_id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    title: { type: DataTypes.STRING(200), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
    cover_url: { type: DataTypes.TEXT, allowNull: false },
    starts_at: { type: DataTypes.DATE, allowNull: false },
    ends_at: { type: DataTypes.DATE, allowNull: true },
    location_name: { type: DataTypes.STRING(200), allowNull: false },
    price_cents: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    currency: {
      type: DataTypes.STRING(3),
      allowNull: false,
      defaultValue: DEFAULT_CURRENCY,
    },
    latitude: { type: DataTypes.DOUBLE, allowNull: true },
    longitude: { type: DataTypes.DOUBLE, allowNull: true },
    attendee_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      validate: { min: 0 },
    },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    tableName: tableNames.Event,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [{ fields: ['starts_at'] }, { fields: ['host_id'] }],
  }
);

export default Event;
