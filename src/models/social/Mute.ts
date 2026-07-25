import { DataTypes, type Model, type Optional } from 'sequelize';
import { sequelize } from '@config/db';
import { tableNames } from '@utils/modelAlias';

// `muter_id` has muted `muted_id`. Muting is the soft cousin of blocking: it
// hides the muted user's videos from the muter's feeds (see feedService /
// rankingService) but — unlike a block — leaves the follow graph and any friend
// relationship intact, and the muted user is never told (socialService.mute).
export interface MuteAttributes {
  mute_id: string;
  muter_id: string;
  muted_id: string;
  created_at: Date;
}

export type MuteCreationAttributes = Optional<
  MuteAttributes,
  'mute_id' | 'created_at'
>;

export interface MuteModel
  extends Model<MuteAttributes, MuteCreationAttributes>,
    MuteAttributes {}

const Mute = sequelize.define<MuteModel>(
  'Mute',
  {
    mute_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    muter_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: tableNames.User, key: 'user_id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    muted_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: tableNames.User, key: 'user_id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    tableName: tableNames.Mute,
    timestamps: false,
    indexes: [
      { unique: true, fields: ['muter_id', 'muted_id'] },
      { fields: ['muter_id'] },
    ],
  }
);

export default Mute;
