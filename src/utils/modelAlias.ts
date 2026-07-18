// Canonical table names + association aliases. Kept in one file so a rename is
// a single edit and every model/query references the same string (mirrors the
// reference backend's utils/modelAlias.ts convention).

export const tableNames = {
  // User / auth
  User: 'users',
  UserSession: 'user_sessions',
  RevokedToken: 'revoked_tokens',
  DeviceToken: 'device_tokens',
  PasswordResetCode: 'password_reset_codes',
  // Social graph
  Follow: 'follows',
  FriendRequest: 'friend_requests',
  Block: 'blocks',
  // Feed / content
  Video: 'videos',
  VideoProduct: 'video_products',
  Engagement: 'engagements',
  Comment: 'comments',
  CommentLike: 'comment_likes',
  Report: 'reports',
  // Commerce
  Seller: 'sellers',
  Product: 'products',
  ProductVariant: 'product_variants',
  ProductImage: 'product_images',
  Order: 'orders',
  OrderItem: 'order_items',
  // Messaging
  Conversation: 'conversations',
  ConversationMember: 'conversation_members',
  Message: 'messages',
  // Events
  Event: 'events',
  EventAttendee: 'event_attendees',
  // Calls
  CallRecord: 'call_records',
} as const;

export type TableNameKeys = keyof typeof tableNames;

export const associations = {
  // Auth
  USER_SESSIONS: 'sessions',
  SESSION_USER: 'user',
  USER_REVOKED_TOKENS: 'revoked_tokens',
  REVOKED_TOKEN_USER: 'revoked_token_owner',
  USER_DEVICE_TOKENS: 'device_tokens',
  DEVICE_TOKEN_USER: 'device_token_owner',
  // Social graph
  FOLLOW_FOLLOWER: 'follower',
  FOLLOW_FOLLOWEE: 'followee',
  FRIEND_REQUEST_REQUESTER: 'requester',
  FRIEND_REQUEST_ADDRESSEE: 'addressee',
  BLOCK_BLOCKER: 'blocker',
  BLOCK_BLOCKED: 'blocked',
  // Feed
  VIDEO_AUTHOR: 'author',
  VIDEO_PRODUCTS: 'product_tags',
  VIDEO_PRODUCT_VIDEO: 'video',
  VIDEO_PRODUCT_PRODUCT: 'product',
  VIDEO_ENGAGEMENTS: 'engagements',
  ENGAGEMENT_USER: 'user',
  ENGAGEMENT_VIDEO: 'video',
  VIDEO_COMMENTS: 'comments',
  COMMENT_VIDEO: 'video',
  COMMENT_AUTHOR: 'author',
  COMMENT_PARENT: 'parent',
  COMMENT_REPLIES: 'replies',
  COMMENT_LIKES: 'comment_likes',
  COMMENT_LIKE_COMMENT: 'comment',
  COMMENT_LIKE_USER: 'user',
  REPORT_REPORTER: 'reporter',
  // Commerce
  PRODUCT_SELLER: 'seller',
  SELLER_PRODUCTS: 'products',
  PRODUCT_VARIANTS: 'variants',
  PRODUCT_VARIANT_PRODUCT: 'product',
  PRODUCT_IMAGES: 'images',
  PRODUCT_IMAGE_PRODUCT: 'product',
  ORDER_USER: 'user',
  ORDER_ITEMS: 'items',
  ORDER_ITEM_ORDER: 'order',
  // Messaging
  CONVERSATION_MEMBERS: 'members',
  MEMBER_CONVERSATION: 'conversation',
  MEMBER_USER: 'user',
  CONVERSATION_MESSAGES: 'messages',
  MESSAGE_CONVERSATION: 'conversation',
  MESSAGE_SENDER: 'sender',
  // Events
  EVENT_HOST: 'host',
  EVENT_ATTENDEES: 'attendees',
  ATTENDEE_EVENT: 'event',
  ATTENDEE_USER: 'user',
  // Calls
  CALL_OWNER: 'owner',
  CALL_PEER: 'peer',
} as const;

export type AssociationKeys = keyof typeof associations;
