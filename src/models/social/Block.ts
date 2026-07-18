import { DataTypes, type Model, type Optional } from 'sequelize';
import { sequelize } from '@config/db';
import { tableNames } from '@utils/modelAlias';

// `blocker_id` has blocked `blocked_id`. Blocking severs the follow graph both
// ways and clears any friend relationship (see socialService.block).
export interface BlockAttributes {
  block_id: string;
  blocker_id: string;
  blocked_id: string;
  created_at: Date;
}

export type BlockCreationAttributes = Optional<
  BlockAttributes,
  'block_id' | 'created_at'
>;

export interface BlockModel
  extends Model<BlockAttributes, BlockCreationAttributes>,
    BlockAttributes {}

const Block = sequelize.define<BlockModel>(
  'Block',
  {
    block_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    blocker_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: tableNames.User, key: 'user_id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    blocked_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: tableNames.User, key: 'user_id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    tableName: tableNames.Block,
    timestamps: false,
    indexes: [
      { unique: true, fields: ['blocker_id', 'blocked_id'] },
      { fields: ['blocked_id'] },
    ],
  }
);

export default Block;
