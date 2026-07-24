import { DataTypes, type Model, type Optional } from 'sequelize';
import { sequelize } from '@config/db';
import { tableNames } from '@utils/modelAlias';

export interface SellerAttributes {
  seller_id: string;
  // The user who runs this shop. Null for platform-owned seed catalog sellers;
  // set when a user registers as a seller. Unique — one seller profile per user.
  user_id: string | null;
  name: string;
  rating: number;
  created_at: Date;
}

export type SellerCreationAttributes = Optional<
  SellerAttributes,
  'seller_id' | 'user_id' | 'rating' | 'created_at'
>;

export interface SellerModel
  extends Model<SellerAttributes, SellerCreationAttributes>,
    SellerAttributes {}

const Seller = sequelize.define<SellerModel>(
  'Seller',
  {
    seller_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: true,
      unique: true,
      references: { model: tableNames.User, key: 'user_id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    },
    name: { type: DataTypes.STRING(120), allowNull: false },
    rating: {
      type: DataTypes.REAL,
      allowNull: false,
      defaultValue: 5,
      validate: { min: 0, max: 5 },
    },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    tableName: tableNames.Seller,
    timestamps: false,
  }
);

export default Seller;
