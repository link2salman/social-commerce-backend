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
import Mute from '@models/social/Mute';

// ── Feed ─────────────────────────────────────────────────────────────────────
import Video from '@models/feed/Video';
import Engagement from '@models/feed/Engagement';
import Comment from '@models/feed/Comment';
import CommentLike from '@models/feed/CommentLike';
import Post from '@models/feed/Post';
import PostMedia from '@models/feed/PostMedia';
import PostEngagement from '@models/feed/PostEngagement';
import PostComment from '@models/feed/PostComment';
import PostCommentLike from '@models/feed/PostCommentLike';

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
import Notification from '@models/notification/Notification';

// ── Background media processing ───────────────────────────────────────────────
// No associations: `subject_id` is polymorphic on `kind` (see the model).
import MediaJob from '@models/media/MediaJob';

// ── Moderation ───────────────────────────────────────────────────────────────
import Report from '@models/moderation/Report';
import Appeal from '@models/moderation/Appeal';

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

// ── Mutes ────────────────────────────────────────────────────────────────────
Mute.belongsTo(User, { foreignKey: 'muter_id', as: A.MUTE_MUTER });
Mute.belongsTo(User, { foreignKey: 'muted_id', as: A.MUTE_MUTED });

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

// ── Posts (image/text content) ───────────────────────────────────────────────
// A parallel stack to the video feed above: its own engagement + comment tables
// so the tested video pipeline stays untouched. Same relation shapes throughout.
Post.belongsTo(User, { foreignKey: 'author_id', as: A.POST_AUTHOR });
User.hasMany(Post, { foreignKey: 'author_id', as: 'posts' });

Post.hasMany(PostMedia, { foreignKey: 'post_id', as: A.POST_MEDIA });
PostMedia.belongsTo(Post, { foreignKey: 'post_id', as: A.POST_MEDIA_POST });

Post.hasMany(PostEngagement, { foreignKey: 'post_id', as: A.POST_ENGAGEMENTS });
PostEngagement.belongsTo(Post, { foreignKey: 'post_id', as: A.POST_ENGAGEMENT_POST });
PostEngagement.belongsTo(User, { foreignKey: 'user_id', as: A.POST_ENGAGEMENT_USER });

Post.hasMany(PostComment, { foreignKey: 'post_id', as: A.POST_COMMENTS });
PostComment.belongsTo(Post, { foreignKey: 'post_id', as: A.POST_COMMENT_POST });
PostComment.belongsTo(User, { foreignKey: 'author_id', as: A.POST_COMMENT_AUTHOR });
PostComment.belongsTo(PostComment, { foreignKey: 'parent_id', as: A.POST_COMMENT_PARENT });
PostComment.hasMany(PostComment, { foreignKey: 'parent_id', as: A.POST_COMMENT_REPLIES });

PostComment.hasMany(PostCommentLike, {
  foreignKey: 'post_comment_id',
  as: A.POST_COMMENT_LIKES,
});
PostCommentLike.belongsTo(PostComment, {
  foreignKey: 'post_comment_id',
  as: A.POST_COMMENT_LIKE_COMMENT,
});
PostCommentLike.belongsTo(User, {
  foreignKey: 'user_id',
  as: A.POST_COMMENT_LIKE_USER,
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
Report.belongsTo(User, { foreignKey: 'reviewed_by', as: A.REPORT_REVIEWER });

Appeal.belongsTo(User, { foreignKey: 'user_id', as: A.APPEAL_APPELLANT });
Appeal.belongsTo(User, { foreignKey: 'reviewed_by', as: A.APPEAL_REVIEWER });

// ── Notifications ────────────────────────────────────────────────────────────
// recipient owns the feed; actor is who caused it (nullable — SET NULL on the
// FK, so a deleted actor leaves the row with a null actor rather than removing
// it). The polymorphic target (target_type + target_id) has no relation.
Notification.belongsTo(User, { foreignKey: 'recipient_id', as: A.NOTIFICATION_RECIPIENT });
Notification.belongsTo(User, { foreignKey: 'actor_id', as: A.NOTIFICATION_ACTOR });

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
  Mute,
  Video,
  Engagement,
  Comment,
  CommentLike,
  Post,
  PostMedia,
  PostEngagement,
  PostComment,
  PostCommentLike,
  Report,
  Appeal,
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
  Notification,
  MediaJob,
};
