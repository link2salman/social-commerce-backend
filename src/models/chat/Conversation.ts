import { DataTypes, type Model, type Optional } from 'sequelize';
import { sequelize } from '@config/db';
import { tableNames } from '@utils/modelAlias';

// last_message_* is denormalized so the inbox list needs no per-row message
// lookup. Updated whenever a message is posted (chatService).
export interface ConversationAttributes {
  conversation_id: string;
  is_group: boolean;
  title: string | null;
  created_by: string | null;
  last_message_body: string | null;
  last_sender_id: string | null;
  last_message_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export type ConversationCreationAttributes = Optional<
  ConversationAttributes,
  | 'conversation_id'
  | 'is_group'
  | 'title'
  | 'created_by'
  | 'last_message_body'
  | 'last_sender_id'
  | 'last_message_at'
  | 'created_at'
  | 'updated_at'
>;

export interface ConversationModel
  extends Model<ConversationAttributes, ConversationCreationAttributes>,
    ConversationAttributes {}

const Conversation = sequelize.define<ConversationModel>(
  'Conversation',
  {
    conversation_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    is_group: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    title: { type: DataTypes.STRING(120), allowNull: true },
    created_by: { type: DataTypes.UUID, allowNull: true },
    last_message_body: { type: DataTypes.TEXT, allowNull: true },
    last_sender_id: { type: DataTypes.UUID, allowNull: true },
    last_message_at: { type: DataTypes.DATE, allowNull: true },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    tableName: tableNames.Conversation,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  }
);

export default Conversation;
