import { DataTypes, type Model, type Optional } from 'sequelize';
import { sequelize } from '@config/db';
import { tableNames } from '@utils/modelAlias';
import { GROUP_ROLES, type GroupRole } from '@constants/enums';

// One row per (conversation, user). `role` is only meaningful for groups; a 1:1
// carries two members (both 'member'). last_read_at drives the unread count.
export interface ConversationMemberAttributes {
  member_id: string;
  conversation_id: string;
  user_id: string;
  role: GroupRole;
  last_read_at: Date | null;
  joined_at: Date;
}

export type ConversationMemberCreationAttributes = Optional<
  ConversationMemberAttributes,
  'member_id' | 'role' | 'last_read_at' | 'joined_at'
>;

export interface ConversationMemberModel
  extends Model<
      ConversationMemberAttributes,
      ConversationMemberCreationAttributes
    >,
    ConversationMemberAttributes {}

const ConversationMember = sequelize.define<ConversationMemberModel>(
  'ConversationMember',
  {
    member_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    conversation_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: tableNames.Conversation, key: 'conversation_id' },
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
    role: {
      type: DataTypes.ENUM(...GROUP_ROLES),
      allowNull: false,
      defaultValue: 'member',
    },
    last_read_at: { type: DataTypes.DATE, allowNull: true },
    joined_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    tableName: tableNames.ConversationMember,
    timestamps: false,
    indexes: [
      { unique: true, fields: ['conversation_id', 'user_id'] },
      { fields: ['user_id'] },
    ],
  }
);

export default ConversationMember;
