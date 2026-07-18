import { DataTypes, type Model, type Optional } from 'sequelize';
import { sequelize } from '@config/db';
import { tableNames } from '@utils/modelAlias';
import { MESSAGE_STATUSES, type MessageStatus } from '@constants/enums';

// attachment mirrors the client's discriminated union (product | video | image)
// and is stored as JSONB; today it is always null (the composer sends imageUrl).
export interface MessageAttachment {
  type: 'product' | 'video' | 'image';
  productId?: string;
  videoId?: string;
  url?: string;
}

export interface MessageAttributes {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  image_url: string | null;
  attachment: MessageAttachment | null;
  status: MessageStatus;
  created_at: Date;
  read_at: Date | null;
}

export type MessageCreationAttributes = Optional<
  MessageAttributes,
  | 'message_id'
  | 'body'
  | 'image_url'
  | 'attachment'
  | 'status'
  | 'created_at'
  | 'read_at'
>;

export interface MessageModel
  extends Model<MessageAttributes, MessageCreationAttributes>,
    MessageAttributes {}

const Message = sequelize.define<MessageModel>(
  'Message',
  {
    message_id: {
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
    sender_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: tableNames.User, key: 'user_id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    body: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
    image_url: { type: DataTypes.TEXT, allowNull: true },
    attachment: { type: DataTypes.JSONB, allowNull: true },
    status: {
      type: DataTypes.ENUM(...MESSAGE_STATUSES),
      allowNull: false,
      defaultValue: 'sent',
    },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    read_at: { type: DataTypes.DATE, allowNull: true },
  },
  {
    tableName: tableNames.Message,
    timestamps: false,
    indexes: [{ fields: ['conversation_id', 'created_at'] }],
  }
);

export default Message;
