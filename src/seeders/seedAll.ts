// Demo seed — mirrors the mobile app's mock fixtures (core/api/mock/mockData.ts)
// so that flipping the app to the real backend yields a populated, working app.
// Idempotent: it TRUNCATEs and re-inserts. Grows one section per domain as the
// build proceeds. Run with `npm run seed`.
import { Op, fn, col } from 'sequelize';
import {
  sequelize,
  User,
  Video,
  Engagement,
  Follow,
  FriendRequest,
  Block,
  Comment,
  CommentLike,
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
} from '@models/index';
import type { CommentCreationAttributes } from '@models/feed/Comment';
import type { EngagementCreationAttributes } from '@models/feed/Engagement';
import type { CommentLikeCreationAttributes } from '@models/feed/CommentLike';
import type { EngagementType, GroupRole } from '@constants/enums';
import { priceCart, type CartItemInput } from '@services/pricingService';
import logger from '@utils/logger';

// ── Roster (index-aligned, from the app's mock) ──────────────────────────────
const USERNAMES = [
  'ava.codes', 'thrift.finds', 'kettle.and.co', 'studio_mira', 'northgear',
  'lena.makes', 'urban.roast', 'the.plant.dad', 'mia.vintage', 'gadget.guru',
  'sol.ceramics', 'trailhead.co', 'clay.and.co', 'field.notes', 'harbor.goods',
  'peak.supply',
];
const DISPLAY_NAMES = [
  'Ava', 'Thrift Finds', 'Kettle & Co.', 'Studio Mira', 'Northgear',
  'Lena Makes', 'Urban Roast', 'The Plant Dad', 'Mia Vintage', 'Gadget Guru',
  'Sol Ceramics', 'Trailhead Co.', 'Clay & Co.', 'Field Notes', 'Harbor Goods',
  'Peak Supply',
];
const BIOS = [
  'Slow mornings & good coffee ☕️ Creator.',
  'Secondhand gems, daily drops ♻️',
  'Hand-thrown ceramics from a tiny studio.',
  'Design studio. Big plans, small team.',
  'Trail gear tested on real trails ⛰️',
  'DIY, woodworking & the occasional fail 🔨',
  'Third-wave coffee, no pretension. Guides + gear.',
  'Too many plants, zero regrets 🌿',
  "'70s & '80s finds, restored with love.",
  'Honest tech reviews. No sponsored fluff.',
  'Glazes & small-batch pottery ✨',
  'Backcountry trips + packing lists.',
  'Wheel-thrown mugs, tiny batches 🏺',
  'Analog journaling & fountain pens ✍️',
  'Coastal home goods, slow made 🌊',
  'Alpine gear for weekend summits 🏔️',
];

// Public sample media, written to `videos.hls_url`. That column is a misnomer —
// it is the playback URL, and two of these three are progressive MP4s, not HLS
// manifests (there is no transcode pipeline; see services/videoService.ts).
const SAMPLE_CLIPS = [
  'https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/bipbop_4x3_variant.m3u8',
  'https://www.w3schools.com/html/mov_bbb.mp4',
  'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
];
// Camera filter ids from the app (features/camera/store/cameraStore.ts →
// FILTERS). Written to `videos.filter_id` purely as recorded intent — nothing
// reads it back yet (see services/videoService.ts). Weighted the way real usage
// runs: mostly unfiltered, a handful of looks, and two nulls standing in for
// rows published before the field existed (a non-camera publish path sends no
// filterId at all, so null is a shape the demo data should contain).
const SAMPLE_FILTERS: (string | null)[] = [
  'none',
  'none',
  'vivid',
  'none',
  null,
  'warm',
  'none',
  'none',
  'mono',
  null,
  'none',
  'beauty',
];
const CAPTIONS = [
  'Morning routine, slowed down ☕️',
  'This one took 3 tries to get right 😅',
  'Restocked — link in the pill 👇',
  "POV: it's finally trail season",
  'Small studio, big plans',
];

// The app's COMMENT_SEEDS — 4 threads, one with no replies (so "View replies"
// is demonstrably conditional). Seeded on every video.
const COMMENT_SEEDS: {
  body: string;
  likes: number;
  replies: { body: string; likes: number }[];
}[] = [
  {
    body: 'Need this in my life 😍',
    likes: 128,
    replies: [
      { body: 'same, it went straight in my cart', likes: 12 },
      { body: 'it sold out in a day last time, be quick', likes: 4 },
    ],
  },
  {
    body: 'Where is this filmed?',
    likes: 41,
    replies: [
      { body: 'looks like the north coast to me', likes: 9 },
      { body: 'nah that’s the studio set 😅', likes: 31 },
      { body: 'confirmed studio, I’ve been there', likes: 2 },
    ],
  },
  { body: 'Okay but the pacing 👏', likes: 17, replies: [] },
  {
    body: 'what filter is this?',
    likes: 63,
    replies: [{ body: 'the warm one, second from the left', likes: 22 }],
  },
];

export const DEMO_PASSWORD = 'password123';
const avatarFor = (username: string): string =>
  `https://i.pravatar.cc/150?u=${encodeURIComponent(username)}`;
const emailFor = (username: string): string => `${username}@demo.social`;
const thumbFor = (seed: string): string =>
  `https://picsum.photos/seed/${encodeURIComponent(seed)}/720/1280`;
const productImg = (seed: string): string =>
  `https://picsum.photos/seed/${encodeURIComponent(seed)}/800/800`;

// Product catalog (from the app's mock PRODUCT_CATALOG). Prices in cents.
const CATALOG = [
  {
    title: 'Ceramic Pour-Over Kettle',
    description:
      'Gooseneck kettle with precision temperature control for slow pour-over brewing.',
    priceCents: 6800,
    stock: 24,
    seller: { name: 'Kettle & Co.', rating: 4.7 },
    images: ['kettle-1', 'kettle-2'],
    variants: [
      { name: 'Matte Black', delta: 0 },
      { name: 'Bone White', delta: 400 },
    ],
  },
  {
    title: 'Recycled Wool Crewneck',
    description:
      'Heavyweight crewneck knit from 70% recycled wool. Runs true to size.',
    priceCents: 5400,
    stock: 9,
    seller: { name: 'Thrift Finds', rating: 4.5 },
    images: ['sweater-1'],
    variants: [
      { name: 'Small', delta: 0 },
      { name: 'Medium', delta: 0 },
      { name: 'Large', delta: 0 },
    ],
  },
  {
    title: 'Trail Running Pack 12L',
    description:
      'Vest-style hydration pack with two 500ml soft flasks included.',
    priceCents: 8900,
    stock: 0,
    seller: { name: 'Northgear', rating: 4.9 },
    images: ['pack-1'],
    variants: [] as { name: string; delta: number }[],
  },
];

// ── Seed functions ───────────────────────────────────────────────────────────
export const seedUsers = async (): Promise<string[]> => {
  const ids: string[] = [];
  for (let i = 0; i < USERNAMES.length; i += 1) {
    const username = USERNAMES[i]!;
    const user = await User.create({
      username,
      email: emailFor(username),
      password_hash: DEMO_PASSWORD, // hashed by the model hook
      display_name: DISPLAY_NAMES[i]!,
      bio: BIOS[i]!,
      avatar_url: avatarFor(username),
      email_verified: true,
    });
    ids.push(user.user_id);
  }
  return ids;
};

// Videos start with every counter at zero. like/dislike/save are reconciled from
// the Engagement rows in seedEngagements, comment_count from the Comment rows in
// seedComments — a counter is never written by hand, so it can never disagree
// with the rows the viewer flags are computed from.
//
// share_count is the one exception: there is no shares table (the app's share
// action is an OS share sheet, nothing is persisted), so it stays a synthetic
// number with no row to derive it from.
export const seedVideos = async (userIds: string[]): Promise<string[]> => {
  const now = Date.now();
  const rows = Array.from({ length: 12 }, (_, i) => {
    const username = USERNAMES[i % USERNAMES.length]!;
    const createdAt = new Date(now - i * 3_600_000);
    return {
      author_id: userIds[i % userIds.length]!,
      hls_url: SAMPLE_CLIPS[i % SAMPLE_CLIPS.length]!,
      thumbnail_url: thumbFor(`video-${i + 1}`),
      caption: CAPTIONS[i % CAPTIONS.length]!,
      duration_ms: 18_000 + (i % 4) * 4_000,
      sound_name: i % 3 === 0 ? `original sound — ${username}` : null,
      // `?? null`, not `!`: this array genuinely holds nulls, and `!` would
      // strip them from the type while the runtime value stayed null.
      filter_id: SAMPLE_FILTERS[i % SAMPLE_FILTERS.length] ?? null,
      share_count: 2 + (i % 5),
      created_at: createdAt,
      updated_at: createdAt,
    };
  });
  const created = await Video.bulkCreate(rows, { returning: true });
  return created.map(v => v.video_id);
};

// ── Engagement (counters ⇄ viewer flags) ─────────────────────────────────────
// Ava (roster index 0) is the demo login, so her engagement is hand-picked
// rather than derived: the first screenful of the feed has to show BOTH states —
// cards she already liked/saved/bookmarked and cards she hasn't touched. Index =
// video index; video 0 is her own upload and is deliberately left alone.
const AVA_ENGAGEMENTS: readonly EngagementType[][] = [
  [], //  0 — Ava's own upload
  ['like'], //  1
  ['like', 'save'], //  2
  [], //  3
  ['dislike'], //  4
  ['like', 'bookmark'], //  5
  [], //  6
  ['like', 'save', 'bookmark', 'favorite'], //  7
  ['favorite'], //  8
  [], //  9
  ['like', 'save'], // 10
  ['bookmark'], // 11
];

// Deterministic roster picker — no RNG, so two runs of the seed produce byte
// identical data. Walks the roster on a stride coprime with its size, so each
// offset yields a different, non-repeating subset.
const pickUsers = (
  offset: number,
  count: number,
  exclude: Set<number>,
  rosterSize: number
): number[] => {
  const picked: number[] = [];
  for (let k = 0; k < rosterSize && picked.length < count; k += 1) {
    const idx = (offset * 3 + k * 5) % rosterSize;
    if (exclude.has(idx) || picked.includes(idx)) continue;
    picked.push(idx);
  }
  return picked;
};

// Derive the video counters from the rows that now exist. Reading the tally back
// out of the DB with a GROUP BY — instead of counting what we pushed — means the
// stored counter is Postgres's own count, so a row dropped by the unique
// (user, video, type) index can never leave the counter overstating reality.
const reconcileVideoCounters = async (videoIds: string[]): Promise<void> => {
  const tallies = (await Engagement.findAll({
    attributes: [
      'video_id',
      'type',
      [fn('COUNT', col('engagement_id')), 'count'],
    ],
    group: ['video_id', 'type'],
    raw: true,
  })) as unknown as Array<{
    video_id: string;
    type: EngagementType;
    count: string;
  }>;

  const byVideo = new Map<string, Partial<Record<EngagementType, number>>>();
  for (const tally of tallies) {
    const entry = byVideo.get(tally.video_id) ?? {};
    entry[tally.type] = Number(tally.count);
    byVideo.set(tally.video_id, entry);
  }

  for (const videoId of videoIds) {
    const tally = byVideo.get(videoId) ?? {};
    // bookmark/favorite are private viewer flags with no public counter — the
    // same three columns engagementService.COUNTER_COLUMN maintains at runtime.
    await Video.update(
      {
        like_count: tally.like ?? 0,
        dislike_count: tally.dislike ?? 0,
        save_count: tally.save ?? 0,
      },
      { where: { video_id: videoId }, silent: true }
    );
  }
};

// Real Engagement rows for the whole roster, then counters derived from them.
// Nothing here writes a like/dislike/save count by hand, so `stats.likes` and
// `viewer.hasLiked` are guaranteed to tell the same story.
export const seedEngagements = async (
  userIds: string[],
  videoIds: string[]
): Promise<number> => {
  const n = userIds.length;
  const rows: EngagementCreationAttributes[] = [];
  const add = (
    userIdx: number,
    videoId: string,
    type: EngagementType
  ): void => {
    rows.push({ user_id: userIds[userIdx]!, video_id: videoId, type });
  };

  videoIds.forEach((videoId, i) => {
    const authorIdx = i % n;
    // Ava is applied explicitly below; nobody engages with their own upload.
    const reserved = new Set([0, authorIdx]);

    // Popularity ladder: the older the video (higher i), the more likes it has
    // accumulated — the ordering the mock faked with `120 + i * 37`, rebuilt on
    // a 16-account roster where every like is a row somebody actually owns.
    const likers = pickUsers(i, Math.min(n - 2, 3 + i), reserved, n);
    likers.forEach(j => add(j, videoId, 'like'));

    // Dislikes only come from accounts that did NOT like it — like and dislike
    // are mutually exclusive (engagementService enforces the same at runtime).
    const dislikers = pickUsers(
      i + 7,
      i % 3,
      new Set([...reserved, ...likers]),
      n
    );
    dislikers.forEach(j => add(j, videoId, 'dislike'));

    // save / bookmark / favorite are independent lists (product decision):
    // overlapping subsets of the likers, thinning out down the list.
    likers.forEach((j, k) => {
      if (k % 2 === 0) add(j, videoId, 'save');
      if (k % 3 === 0) add(j, videoId, 'bookmark');
      if (k % 4 === 0) add(j, videoId, 'favorite');
    });

    (AVA_ENGAGEMENTS[i] ?? []).forEach(type => add(0, videoId, type));
  });

  await Engagement.bulkCreate(rows, { ignoreDuplicates: true });
  await reconcileVideoCounters(videoIds);
  return rows.length;
};

export const seedFollows = async (userIds: string[]): Promise<void> => {
  const n = userIds.length;
  const seen = new Set<string>();
  const rows: Array<{ follower_id: string; followee_id: string }> = [];
  const add = (a: number, b: number): void => {
    if (a === b) return;
    const key = `${a}:${b}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ follower_id: userIds[a]!, followee_id: userIds[b]! });
  };
  // A connected ring so every profile has followers + following.
  for (let i = 0; i < n; i += 1) {
    add(i, (i + 1) % n);
    add(i, (i + 3) % n);
  }
  // Ava (index 0) follows the first creators so her "following" feed is rich...
  [1, 2, 3, 4, 5, 6, 7, 8].forEach(j => add(0, j));
  // ...and several creators follow Ava back.
  [1, 2, 4, 6, 9, 11, 13, 15].forEach(j => add(j, 0));
  await Follow.bulkCreate(rows);
};

// Friend graph relative to Ava (index 0): incoming requests populate her
// friend-requests inbox, an accepted set gives her a friends list, and a block
// exercises the blocked state + search exclusion.
export const seedFriendGraph = async (userIds: string[]): Promise<void> => {
  const ava = userIds[0]!;
  const reqs: Array<{
    requester_id: string;
    addressee_id: string;
    status: 'pending' | 'accepted';
  }> = [];
  // Incoming (they → Ava, pending).
  [1, 5, 9].forEach(j =>
    reqs.push({ requester_id: userIds[j]!, addressee_id: ava, status: 'pending' })
  );
  // Outgoing (Ava → them, pending).
  [2, 7].forEach(j =>
    reqs.push({ requester_id: ava, addressee_id: userIds[j]!, status: 'pending' })
  );
  // Accepted friendships (Ava ↔ them).
  [3, 6, 11].forEach(j =>
    reqs.push({ requester_id: ava, addressee_id: userIds[j]!, status: 'accepted' })
  );
  await FriendRequest.bulkCreate(reqs);

  // Ava blocks peak.supply (index 15) — sever the follow graph both ways to keep
  // the seed consistent with the block semantics (socialService.block).
  const blocked = userIds[15]!;
  await Block.create({ blocker_id: ava, blocked_id: blocked });
  await Follow.destroy({
    where: {
      [Op.or]: [
        { follower_id: ava, followee_id: blocked },
        { follower_id: blocked, followee_id: ava },
      ],
    },
  });
};

// A comment as inserted, carrying what seedCommentLikes needs. `likeWeight` is
// the mock's like number — a WEIGHT for how many accounts like the comment, not
// the count itself: the count is derived from the CommentLike rows.
export interface SeededComment {
  commentId: string;
  authorIdx: number;
  likeWeight: number;
}

// Seed the COMMENT_SEEDS threads on every video, then reconcile each video's
// comment_count to the true total (top-level + replies). like_count is left at
// the column default here and derived later from real rows in seedCommentLikes.
export const seedComments = async (
  userIds: string[],
  videoIds: string[]
): Promise<SeededComment[]> => {
  const n = userIds.length;
  let author = 0;
  const now = Date.now();
  const seeded: SeededComment[] = [];

  for (const videoId of videoIds) {
    const topAuthorIdx: number[] = [];
    const topRows = COMMENT_SEEDS.map((seed, i) => {
      const authorIdx = author++ % n;
      topAuthorIdx.push(authorIdx);
      return {
        video_id: videoId,
        author_id: userIds[authorIdx]!,
        parent_id: null,
        body: seed.body,
        created_at: new Date(now - (i + 1) * 1_800_000),
      };
    });
    const created = await Comment.bulkCreate(topRows, { returning: true });
    created.forEach((row, i) =>
      seeded.push({
        commentId: row.comment_id,
        authorIdx: topAuthorIdx[i]!,
        likeWeight: COMMENT_SEEDS[i]!.likes,
      })
    );

    const replyRows: CommentCreationAttributes[] = [];
    const replyMeta: Array<{ authorIdx: number; likeWeight: number }> = [];
    COMMENT_SEEDS.forEach((seed, i) => {
      const parent = created[i]!;
      const parentAt = new Date(now - (i + 1) * 1_800_000).getTime();
      seed.replies.forEach((reply, j) => {
        const authorIdx = author++ % n;
        replyRows.push({
          video_id: videoId,
          author_id: userIds[authorIdx]!,
          parent_id: parent.comment_id,
          body: reply.body,
          created_at: new Date(parentAt + (j + 1) * 300_000),
        });
        replyMeta.push({ authorIdx, likeWeight: reply.likes });
      });
    });
    if (replyRows.length) {
      const createdReplies = await Comment.bulkCreate(replyRows, {
        returning: true,
      });
      createdReplies.forEach((row, i) =>
        seeded.push({
          commentId: row.comment_id,
          authorIdx: replyMeta[i]!.authorIdx,
          likeWeight: replyMeta[i]!.likeWeight,
        })
      );
    }

    await Video.update(
      { comment_count: topRows.length + replyRows.length },
      { where: { video_id: videoId }, silent: true }
    );
  }
  return seeded;
};

// The mock's like numbers (128, 41, 17, …) cannot be reproduced literally on a
// 16-account roster, so they are scaled to a liker count — roughly one liker per
// 10 mock likes — which keeps the threads in the same popularity order while
// every like remains a row a real seeded account owns.
const likersForWeight = (weight: number, rosterSize: number): number =>
  Math.max(0, Math.min(rosterSize - 1, Math.round(weight / 10)));

// Derive each comment's like_count from the CommentLike rows that exist.
// Grouped by count so this is a handful of UPDATEs rather than one per comment.
const reconcileCommentCounters = async (
  commentIds: string[]
): Promise<void> => {
  const tallies = (await CommentLike.findAll({
    attributes: ['comment_id', [fn('COUNT', col('like_id')), 'count']],
    group: ['comment_id'],
    raw: true,
  })) as unknown as Array<{ comment_id: string; count: string }>;
  const countByComment = new Map(
    tallies.map(t => [t.comment_id, Number(t.count)])
  );

  const idsByCount = new Map<number, string[]>();
  for (const id of commentIds) {
    const count = countByComment.get(id) ?? 0;
    const bucket = idsByCount.get(count);
    if (bucket) bucket.push(id);
    else idsByCount.set(count, [id]);
  }
  for (const [count, ids] of idsByCount) {
    await Comment.update(
      { like_count: count },
      { where: { comment_id: { [Op.in]: ids } } }
    );
  }
};

// Real CommentLike rows, then like_count derived from them — so a comment's
// heart count and the viewer's `hasLiked` can never contradict each other.
export const seedCommentLikes = async (
  userIds: string[],
  comments: SeededComment[]
): Promise<number> => {
  const n = userIds.length;
  const rows: CommentLikeCreationAttributes[] = [];

  comments.forEach((comment, i) => {
    // Ava is applied explicitly below; nobody likes their own comment.
    const reserved = new Set([comment.authorIdx, 0]);
    const likers = pickUsers(
      i,
      likersForWeight(comment.likeWeight, n),
      reserved,
      n
    );
    // The demo login likes every third comment that has any likes at all, so
    // the heart toggle renders in both states within a single thread.
    if (likers.length > 0 && comment.authorIdx !== 0 && i % 3 === 0) {
      likers.push(0);
    }
    likers.forEach(j =>
      rows.push({ comment_id: comment.commentId, user_id: userIds[j]! })
    );
  });

  await CommentLike.bulkCreate(rows, { ignoreDuplicates: true });
  await reconcileCommentCounters(comments.map(c => c.commentId));
  return rows.length;
};

export interface SeededCatalog {
  productIds: string[];
  variantIdsByProduct: string[][];
}

export const seedProducts = async (): Promise<SeededCatalog> => {
  const productIds: string[] = [];
  const variantIdsByProduct: string[][] = [];
  for (const entry of CATALOG) {
    const seller = await Seller.create({
      name: entry.seller.name,
      rating: entry.seller.rating,
    });
    const product = await Product.create({
      seller_id: seller.seller_id,
      title: entry.title,
      description: entry.description,
      price_cents: entry.priceCents,
      currency: 'USD',
      stock: entry.stock,
    });
    await ProductImage.bulkCreate(
      entry.images.map((seed, pos) => ({
        product_id: product.product_id,
        url: productImg(seed),
        position: pos,
      }))
    );
    const variants = await ProductVariant.bulkCreate(
      entry.variants.map((v, pos) => ({
        product_id: product.product_id,
        name: v.name,
        price_delta_cents: v.delta,
        position: pos,
      })),
      { returning: true }
    );
    productIds.push(product.product_id);
    variantIdsByProduct.push(variants.map(v => v.variant_id));
  }
  return { productIds, variantIdsByProduct };
};

// Even-index videos carry a product pill (mock: i % 2 === 0 → PRODUCT[i % 3]).
export const seedVideoProducts = async (
  videoIds: string[],
  productIds: string[]
): Promise<void> => {
  const rows: Array<{ video_id: string; product_id: string; position: number }> =
    [];
  videoIds.forEach((videoId, i) => {
    if (i % 2 === 0) {
      rows.push({
        video_id: videoId,
        product_id: productIds[i % productIds.length]!,
        position: 0,
      });
    }
  });
  if (rows.length) await VideoProduct.bulkCreate(rows);
};

// Two past orders for Ava so the history screen isn't empty (mock seedOrders).
export const seedOrders = async (
  avaId: string,
  catalog: SeededCatalog
): Promise<void> => {
  const day = 86_400_000;
  const now = Date.now();
  const place = async (
    items: CartItemInput[],
    createdAt: Date
  ): Promise<void> => {
    const priced = await priceCart(items);
    const order = await Order.create({
      user_id: avaId,
      status: 'confirmed',
      payment_status: 'succeeded',
      currency: priced.currency,
      subtotal_cents: priced.subtotalCents,
      shipping_cents: priced.shippingCents,
      tax_cents: priced.taxCents,
      total_cents: priced.totalCents,
      payment_token: 'seed',
      created_at: createdAt,
    });
    await OrderItem.bulkCreate(
      priced.orderLines.map(line => ({ ...line, order_id: order.order_id }))
    );
  };

  await place(
    [{ productId: catalog.productIds[1]!, variantId: null, quantity: 1 }],
    new Date(now - 2 * day)
  );
  await place(
    [
      {
        productId: catalog.productIds[0]!,
        variantId: catalog.variantIdsByProduct[0]![0] ?? null,
        quantity: 2,
      },
      { productId: catalog.productIds[2]!, variantId: null, quantity: 1 },
    ],
    new Date(now - 9 * day)
  );
};

// Messaging: 3 DMs + one group (from the app's mock seedConversations), with
// per-member last_read_at set so the unread badges match the mock.
export const seedConversations = async (userIds: string[]): Promise<void> => {
  const ava = userIds[0]!;
  const now = Date.now();

  // Set Ava's last_read_at so exactly `unread` of the peer/other messages are
  // newer than it (mirrors the mock's unread counts).
  const setUnread = async (
    conversationId: string,
    others: Date[],
    unread: number
  ): Promise<void> => {
    const sorted = [...others].sort((a, z) => a.getTime() - z.getTime());
    let lastRead: Date;
    if (unread <= 0) lastRead = new Date();
    else if (unread >= sorted.length) lastRead = new Date(0);
    else lastRead = new Date(sorted[sorted.length - unread]!.getTime() - 1);
    await ConversationMember.update(
      { last_read_at: lastRead },
      { where: { conversation_id: conversationId, user_id: ava } }
    );
  };

  const build = async (opts: {
    isGroup: boolean;
    title: string | null;
    memberRoles: Array<[idx: number, role: GroupRole]>; // includes Ava
    msgs: Array<[senderIdx: number, body: string]>;
    baseAgoMin: number;
    stepMin: number;
    unread: number;
  }): Promise<void> => {
    const conv = await Conversation.create({
      is_group: opts.isGroup,
      title: opts.title,
      created_by: ava,
    });
    await ConversationMember.bulkCreate(
      opts.memberRoles.map(([idx, role]) => ({
        conversation_id: conv.conversation_id,
        user_id: userIds[idx]!,
        role,
      }))
    );
    const len = opts.msgs.length;
    const rows = opts.msgs.map(([senderIdx, body], i) => ({
      conversation_id: conv.conversation_id,
      sender_id: userIds[senderIdx]!,
      body,
      status: 'read' as const,
      created_at: new Date(now - (opts.baseAgoMin + (len - i) * opts.stepMin) * 60000),
    }));
    await Message.bulkCreate(rows);
    const last = rows[len - 1]!;
    await conv.update({
      last_message_body: last.body,
      last_sender_id: last.sender_id,
      last_message_at: last.created_at,
      updated_at: last.created_at,
    });
    const otherDates = rows
      .filter(r => r.sender_id !== ava)
      .map(r => r.created_at);
    await setUnread(conv.conversation_id, otherDates, opts.unread);
  };

  // DMs (peer idx: user-2→1, user-3→2, user-4→3). senderIdx 0 = me (Ava).
  await build({
    isGroup: false,
    title: null,
    memberRoles: [
      [0, 'member'],
      [1, 'member'],
    ],
    msgs: [
      [1, 'Hey! Loved your latest video 🙌'],
      [0, 'Thank you!! 🙏'],
      [1, 'Is the kettle back in stock?'],
    ],
    baseAgoMin: 8,
    stepMin: 1,
    unread: 1,
  });
  await build({
    isGroup: false,
    title: null,
    memberRoles: [
      [0, 'member'],
      [2, 'member'],
    ],
    msgs: [
      [2, 'sent you the sample pack'],
      [0, 'got it, looks great'],
    ],
    baseAgoMin: 140,
    stepMin: 1,
    unread: 0,
  });
  await build({
    isGroup: false,
    title: null,
    memberRoles: [
      [0, 'member'],
      [3, 'member'],
    ],
    msgs: [[3, 'collab next week?']],
    baseAgoMin: 1500,
    stepMin: 1,
    unread: 1,
  });

  // Group "Studio drop crew" (members user-3→2 admin, user-6→5, user-11→10).
  await build({
    isGroup: true,
    title: 'Studio drop crew',
    memberRoles: [
      [0, 'owner'],
      [2, 'admin'],
      [5, 'member'],
      [10, 'member'],
    ],
    msgs: [
      [2, 'glaze samples are in 🏺'],
      [5, 'ooh which ones made it?'],
      [2, 'matte sand + the speckled blue'],
      [0, 'both please. drop still friday?'],
      [10, "friday works — I'll shoot the studio clips thursday"],
    ],
    baseAgoMin: 45,
    stepMin: 3,
    unread: 2,
  });
};

// Events (from the app's mock EVENT_SEEDS). host index = mock user-N → N-1.
interface EventSeed {
  title: string;
  description: string;
  host: number;
  locationName: string;
  inDays: number;
  hour: number;
  durationHours: number | null;
  baseAttendees: number;
  attending: boolean;
  priceCents: number;
  latitude: number | null;
  longitude: number | null;
}
const EVENT_SEEDS: EventSeed[] = [
  { title: 'Pour-Over Basics Workshop', description: "Two hours on grind size, bloom and pour rate — the three things that actually change your cup. We'll brew the same beans four ways and taste the difference side by side. Kettles and beans provided; bring a notebook.", host: 2, locationName: 'Kettle & Co. Studio, Portland', inDays: 3, hour: 19, durationHours: 2, baseAttendees: 42, attending: true, priceCents: 3500, latitude: 45.5152, longitude: -122.6784 },
  { title: 'Vintage Market — Rack Drop', description: "Forty racks of '70s and '80s finds, all restored and priced to move. Early access for the first fifty through the door. Card and cash accepted, tailoring on site.", host: 8, locationName: 'The Old Cannery, Seattle', inDays: 6, hour: 11, durationHours: 6, baseAttendees: 318, attending: false, priceCents: 0, latitude: 47.6062, longitude: -122.3321 },
  { title: 'Sunrise Trail Run + Coffee', description: 'Easy 8k on the ridge loop, no drop policy — we regroup at every junction. Coffee and pastries at the trailhead after. All paces genuinely welcome.', host: 11, locationName: 'Ridge Loop Trailhead, Boulder', inDays: 9, hour: 6, durationHours: 3, baseAttendees: 27, attending: false, priceCents: 0, latitude: 40.015, longitude: -105.2705 },
  { title: 'Glaze Night: Small-Batch Pottery', description: "Bring a bisque piece or use one of ours. We'll run through dipping, layering and wax resist, then everything goes in the kiln together. Pieces ready for pickup the following week.", host: 10, locationName: 'Sol Ceramics, Oakland', inDays: 12, hour: 18, durationHours: 3, baseAttendees: 16, attending: true, priceCents: 4500, latitude: 37.8044, longitude: -122.2712 },
  { title: 'Plant Swap & Repotting Clinic', description: "Bring a cutting, leave with something new. Free repotting all afternoon — soil and pots on us, just bring the plant that's outgrown its home.", host: 7, locationName: 'Greenhouse No. 4, Austin', inDays: 17, hour: 14, durationHours: 4, baseAttendees: 89, attending: false, priceCents: 0, latitude: 30.2672, longitude: -97.7431 },
  { title: 'Creator Meetup: Shooting Product Video', description: 'Three creators break down a shot they got right and one they botched. Lighting on a budget, phone-only setups, and what actually converts. Stay after for open Q&A.', host: 3, locationName: 'Studio Mira, Brooklyn', inDays: 24, hour: 18, durationHours: null, baseAttendees: 134, attending: false, priceCents: 2500, latitude: null, longitude: null },
  { title: 'Sharpen Night: Chisels & Hand Planes', description: "Bring your dullest chisel. We'll work the waterstone progression, flatten a few backs, and set a plane iron by feel rather than by numbers. Stones and strops provided — leave with an edge that takes shavings you can read through.", host: 5, locationName: "Lena's Garage Shop, Tacoma", inDays: 1, hour: 18, durationHours: 2, baseAttendees: 31, attending: true, priceCents: 1500, latitude: null, longitude: null },
  { title: 'Fountain Pen Repair Clinic', description: "Bring a pen that skips, hard-starts or won't fill. We'll flush feeds, align nib tines under a loupe, and re-sac the vintage ones. Ink samples out on the back table all afternoon.", host: 13, locationName: 'Field Notes Studio, Chicago', inDays: 20, hour: 13, durationHours: 4, baseAttendees: 23, attending: false, priceCents: 0, latitude: null, longitude: null },
  { title: 'Cupping Table: Ethiopia Side by Side', description: 'Six lots from the same harvest — naturals and washed — cupped blind. We break the crust together, score them, then reveal the bags. No experience needed; the table teaches you faster than we can.', host: 6, locationName: 'Urban Roast Roastery, Denver', inDays: 24, hour: 10, durationHours: 2, baseAttendees: 54, attending: true, priceCents: 2000, latitude: null, longitude: null },
  { title: 'Crevasse Rescue Refresher', description: "Anchors, hauling systems, and the 3:1 you'll actually build with cold hands. We run it on real snow, not a gym floor. Bring harness, prusiks and two locking biners — rope and pickets are on us.", host: 15, locationName: 'Snow Lake Basin, North Bend', inDays: 27, hour: 9, durationHours: 5, baseAttendees: 12, attending: true, priceCents: 4000, latitude: null, longitude: null },
  { title: 'Denim Repair Bar', description: 'Free darning and patching on anything denim — bring your blown-out knees. Two machines running plus a hand-sashiko table for the pairs worth the extra hour. First come, first stitched.', host: 1, locationName: 'Thrift Finds Warehouse, Seattle', inDays: 31, hour: 12, durationHours: 5, baseAttendees: 96, attending: false, priceCents: 0, latitude: null, longitude: null },
  { title: 'Throw a Mug in One Sitting', description: "Centering is the whole game and it's the part nobody shows you honestly. Three hours on the wheel, one mug each, handle pulled and attached before you leave. We trim and fire; pickup in three weeks.", host: 12, locationName: 'Clay & Co. Studio, Providence', inDays: 38, hour: 11, durationHours: 3, baseAttendees: 18, attending: false, priceCents: 4000, latitude: null, longitude: null },
  { title: 'Pack Shakedown Before the Season', description: 'Dump your pack on the table and we talk through every item — what it weighs and why it earned the space. Scale on hand. Most people leave two pounds lighter without buying a thing.', host: 4, locationName: 'Northgear Loft, Portland', inDays: 44, hour: 17, durationHours: 2, baseAttendees: 21, attending: true, priceCents: 0, latitude: null, longitude: null },
  { title: 'Seconds Sale: Harbor Goods Pop-Up', description: "Samples and seconds from the year's runs — the pieces with a glaze skip or a short weave that never made the shelf. Everything half price or better. Coffee cart out front.", host: 14, locationName: 'Pier 7 Warehouse, Bellingham', inDays: 51, hour: 10, durationHours: 8, baseAttendees: 240, attending: false, priceCents: 0, latitude: null, longitude: null },
];

export const seedEvents = async (userIds: string[]): Promise<void> => {
  const ava = userIds[0]!;
  for (let i = 0; i < EVENT_SEEDS.length; i += 1) {
    const s = EVENT_SEEDS[i]!;
    const start = new Date();
    start.setDate(start.getDate() + s.inDays);
    start.setHours(s.hour, 0, 0, 0);
    const end =
      s.durationHours === null
        ? null
        : new Date(start.getTime() + s.durationHours * 3_600_000);
    const event = await Event.create({
      host_id: userIds[s.host]!,
      title: s.title,
      description: s.description,
      cover_url: `https://picsum.photos/seed/event-${i + 1}-cover/1200/675`,
      starts_at: start,
      ends_at: end,
      location_name: s.locationName,
      price_cents: s.priceCents,
      currency: 'USD',
      latitude: s.latitude,
      longitude: s.longitude,
      attendee_count: s.baseAttendees,
    });
    if (s.attending) {
      await EventAttendee.create({
        event_id: event.event_id,
        user_id: ava,
        has_ticket: s.priceCents > 0,
      });
    }
  }
};

// Call log for Ava (from the app's mock seedCalls). peerIdx = mock user-N → N-1.
export const seedCalls = async (userIds: string[]): Promise<void> => {
  const ava = userIds[0]!;
  const now = Date.now();
  const seeds: Array<{
    peerIdx: number;
    agoMin: number;
    direction: 'incoming' | 'outgoing';
    isVideo: boolean;
    outcome: 'completed' | 'missed' | 'declined';
    durationSec: number;
  }> = [
    { peerIdx: 1, agoMin: 25, direction: 'incoming', isVideo: false, outcome: 'completed', durationSec: 312 },
    { peerIdx: 3, agoMin: 95, direction: 'outgoing', isVideo: true, outcome: 'completed', durationSec: 1284 },
    { peerIdx: 2, agoMin: 260, direction: 'incoming', isVideo: false, outcome: 'missed', durationSec: 0 },
    { peerIdx: 5, agoMin: 1180, direction: 'outgoing', isVideo: false, outcome: 'declined', durationSec: 0 },
    { peerIdx: 4, agoMin: 2600, direction: 'incoming', isVideo: true, outcome: 'completed', durationSec: 47 },
  ];
  await CallRecord.bulkCreate(
    seeds.map(s => ({
      owner_id: ava,
      peer_id: userIds[s.peerIdx]!,
      peer_username: USERNAMES[s.peerIdx]!,
      peer_avatar_url: avatarFor(USERNAMES[s.peerIdx]!),
      direction: s.direction,
      is_video: s.isVideo,
      outcome: s.outcome,
      started_at: new Date(now - s.agoMin * 60000),
      duration_sec: s.durationSec,
    }))
  );
};

// ── Orchestrator ─────────────────────────────────────────────────────────────
export const runSeed = async (): Promise<void> => {
  await sequelize.authenticate();
  // Full reset. `users` and `sellers` are the two roots: everything else has an
  // FK path back to one of them, so CASCADE from both clears the whole schema
  // (sellers → products has no user FK, so it must be truncated explicitly).
  await sequelize.query('TRUNCATE TABLE users, sellers CASCADE;');

  const userIds = await seedUsers();
  const videoIds = await seedVideos(userIds);
  await seedFollows(userIds);
  await seedFriendGraph(userIds);
  const engagements = await seedEngagements(userIds, videoIds);
  const comments = await seedComments(userIds, videoIds);
  const commentLikes = await seedCommentLikes(userIds, comments);
  const catalog = await seedProducts();
  await seedVideoProducts(videoIds, catalog.productIds);
  await seedOrders(userIds[0]!, catalog);
  await seedConversations(userIds);
  await seedEvents(userIds);
  await seedCalls(userIds);

  logger.info(
    {
      users: userIds.length,
      videos: videoIds.length,
      engagements,
      comments: comments.length,
      commentLikes,
      products: catalog.productIds.length,
    },
    'seed complete — log in with any {username}@demo.social / ' +
      `${DEMO_PASSWORD} (e.g. ava.codes@demo.social)`
  );
};

// Only run when executed directly (not when imported by a test).
if (require.main === module) {
  runSeed()
    .then(() => sequelize.close())
    .then(() => process.exit(0))
    .catch(err => {
      logger.error({ err }, 'seed failed');
      process.exit(1);
    });
}
