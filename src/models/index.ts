// Model barrel + central association wiring.
//
// Associations are declared HERE rather than inside each model's associate()
// hook — it keeps the (otherwise cycle-prone) graph in one readable place and
// guarantees every model class is initialised before any relation is defined.
// Grows one block per domain as the build proceeds.

import { sequelize } from '@config/db';
import { associations as A } from '@utils/modelAlias';

// ── User / auth ──────────────────────────────────────────────────────────────
import User from '@models/user/User';
import UserSession from '@models/user/UserSession';
import RevokedToken from '@models/user/RevokedToken';
import DeviceToken from '@models/user/DeviceToken';
import PasswordResetCode from '@models/user/PasswordResetCode';

// ── Social graph ─────────────────────────────────────────────────────────────
import Follow from '@models/social/Follow';
import FriendRequest from '@models/social/FriendRequest';
import Block from '@models/social/Block';

// ── Feed ─────────────────────────────────────────────────────────────────────
import Video from '@models/feed/Video';
import Engagement from '@models/feed/Engagement';
import Comment from '@models/feed/Comment';
import CommentLike from '@models/feed/CommentLike';

// ── Commerce ─────────────────────────────────────────────────────────────────
import Seller from '@models/commerce/Seller';
import Product from '@models/commerce/Product';
import ProductVariant from '@models/commerce/ProductVariant';
import ProductImage from '@models/commerce/ProductImage';
import VideoProduct from '@models/commerce/VideoProduct';
import Order from '@models/commerce/Order';
import OrderItem from '@models/commerce/OrderItem';

// ── Messaging ────────────────────────────────────────────────────────────────
import Conversation from '@models/chat/Conversation';
import ConversationMember from '@models/chat/ConversationMember';
import Message from '@models/chat/Message';

// ── Events ───────────────────────────────────────────────────────────────────
import Event from '@models/events/Event';
import EventAttendee from '@models/events/EventAttendee';

// ── Calls ────────────────────────────────────────────────────────────────────
import CallRecord from '@models/calls/CallRecord';

// ── Moderation ───────────────────────────────────────────────────────────────
import Report from '@models/moderation/Report';

// ── Auth relations ───────────────────────────────────────────────────────────
User.hasMany(UserSession, { foreignKey: 'user_id', as: A.USER_SESSIONS });
UserSession.belongsTo(User, { foreignKey: 'user_id', as: A.SESSION_USER });

User.hasMany(RevokedToken, { foreignKey: 'user_id', as: A.USER_REVOKED_TOKENS });
RevokedToken.belongsTo(User, {
  foreignKey: 'user_id',
  as: A.REVOKED_TOKEN_USER,
});

User.hasMany(DeviceToken, { foreignKey: 'user_id', as: A.USER_DEVICE_TOKENS });
DeviceToken.belongsTo(User, { foreignKey: 'user_id', as: A.DEVICE_TOKEN_USER });

PasswordResetCode.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// ── Follow graph ─────────────────────────────────────────────────────────────
Follow.belongsTo(User, { foreignKey: 'follower_id', as: A.FOLLOW_FOLLOWER });
Follow.belongsTo(User, { foreignKey: 'followee_id', as: A.FOLLOW_FOLLOWEE });

// ── Friend requests ──────────────────────────────────────────────────────────
FriendRequest.belongsTo(User, {
  foreignKey: 'requester_id',
  as: A.FRIEND_REQUEST_REQUESTER,
});
FriendRequest.belongsTo(User, {
  foreignKey: 'addressee_id',
  as: A.FRIEND_REQUEST_ADDRESSEE,
});

// ── Blocks ───────────────────────────────────────────────────────────────────
Block.belongsTo(User, { foreignKey: 'blocker_id', as: A.BLOCK_BLOCKER });
Block.belongsTo(User, { foreignKey: 'blocked_id', as: A.BLOCK_BLOCKED });

// ── Feed relations ───────────────────────────────────────────────────────────
Video.belongsTo(User, { foreignKey: 'author_id', as: A.VIDEO_AUTHOR });
User.hasMany(Video, { foreignKey: 'author_id', as: 'videos' });

Video.hasMany(Engagement, { foreignKey: 'video_id', as: A.VIDEO_ENGAGEMENTS });
Engagement.belongsTo(Video, { foreignKey: 'video_id', as: A.ENGAGEMENT_VIDEO });
Engagement.belongsTo(User, { foreignKey: 'user_id', as: A.ENGAGEMENT_USER });

// ── Comments ─────────────────────────────────────────────────────────────────
Video.hasMany(Comment, { foreignKey: 'video_id', as: A.VIDEO_COMMENTS });
Comment.belongsTo(Video, { foreignKey: 'video_id', as: A.COMMENT_VIDEO });
Comment.belongsTo(User, { foreignKey: 'author_id', as: A.COMMENT_AUTHOR });
Comment.belongsTo(Comment, { foreignKey: 'parent_id', as: A.COMMENT_PARENT });
Comment.hasMany(Comment, { foreignKey: 'parent_id', as: A.COMMENT_REPLIES });

Comment.hasMany(CommentLike, { foreignKey: 'comment_id', as: A.COMMENT_LIKES });
CommentLike.belongsTo(Comment, {
  foreignKey: 'comment_id',
  as: A.COMMENT_LIKE_COMMENT,
});
CommentLike.belongsTo(User, {
  foreignKey: 'user_id',
  as: A.COMMENT_LIKE_USER,
});

// ── Commerce ─────────────────────────────────────────────────────────────────
Product.belongsTo(Seller, { foreignKey: 'seller_id', as: A.PRODUCT_SELLER });
Seller.hasMany(Product, { foreignKey: 'seller_id', as: A.SELLER_PRODUCTS });

Product.hasMany(ProductVariant, {
  foreignKey: 'product_id',
  as: A.PRODUCT_VARIANTS,
});
ProductVariant.belongsTo(Product, {
  foreignKey: 'product_id',
  as: A.PRODUCT_VARIANT_PRODUCT,
});

Product.hasMany(ProductImage, {
  foreignKey: 'product_id',
  as: A.PRODUCT_IMAGES,
});
ProductImage.belongsTo(Product, {
  foreignKey: 'product_id',
  as: A.PRODUCT_IMAGE_PRODUCT,
});

Video.hasMany(VideoProduct, { foreignKey: 'video_id', as: A.VIDEO_PRODUCTS });
VideoProduct.belongsTo(Video, {
  foreignKey: 'video_id',
  as: A.VIDEO_PRODUCT_VIDEO,
});
VideoProduct.belongsTo(Product, {
  foreignKey: 'product_id',
  as: A.VIDEO_PRODUCT_PRODUCT,
});

Order.belongsTo(User, { foreignKey: 'user_id', as: A.ORDER_USER });
Order.hasMany(OrderItem, { foreignKey: 'order_id', as: A.ORDER_ITEMS });
OrderItem.belongsTo(Order, { foreignKey: 'order_id', as: A.ORDER_ITEM_ORDER });
OrderItem.belongsTo(Product, { foreignKey: 'product_id', as: 'product' });

// ── Messaging ────────────────────────────────────────────────────────────────
Conversation.hasMany(ConversationMember, {
  foreignKey: 'conversation_id',
  as: A.CONVERSATION_MEMBERS,
});
ConversationMember.belongsTo(Conversation, {
  foreignKey: 'conversation_id',
  as: A.MEMBER_CONVERSATION,
});
ConversationMember.belongsTo(User, {
  foreignKey: 'user_id',
  as: A.MEMBER_USER,
});

Conversation.hasMany(Message, {
  foreignKey: 'conversation_id',
  as: A.CONVERSATION_MESSAGES,
});
Message.belongsTo(Conversation, {
  foreignKey: 'conversation_id',
  as: A.MESSAGE_CONVERSATION,
});
Message.belongsTo(User, { foreignKey: 'sender_id', as: A.MESSAGE_SENDER });

// ── Events ───────────────────────────────────────────────────────────────────
Event.belongsTo(User, { foreignKey: 'host_id', as: A.EVENT_HOST });
Event.hasMany(EventAttendee, {
  foreignKey: 'event_id',
  as: A.EVENT_ATTENDEES,
});
EventAttendee.belongsTo(Event, {
  foreignKey: 'event_id',
  as: A.ATTENDEE_EVENT,
});
EventAttendee.belongsTo(User, { foreignKey: 'user_id', as: A.ATTENDEE_USER });

// ── Calls ────────────────────────────────────────────────────────────────────
// peer_id is a frozen snapshot, not a live relation — only the owner is joined.
CallRecord.belongsTo(User, { foreignKey: 'owner_id', as: A.CALL_OWNER });

// ── Moderation ───────────────────────────────────────────────────────────────
Report.belongsTo(User, { foreignKey: 'reporter_id', as: A.REPORT_REPORTER });

export {
  sequelize,
  User,
  UserSession,
  RevokedToken,
  DeviceToken,
  PasswordResetCode,
  Follow,
  FriendRequest,
  Block,
  Video,
  Engagement,
  Comment,
  CommentLike,
  Report,
  Seller,
  Product,
  ProductVariant,
  ProductImage,
  VideoProduct,
  Order,
  OrderItem,
  Conversation,
  ConversationMember,
  Message,
  Event,
  EventAttendee,
  CallRecord,
};
