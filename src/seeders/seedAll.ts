// Demo seed — mirrors the mobile app's mock fixtures (core/api/mock/mockData.ts)
// so that flipping the app to the real backend yields a populated, working app.
// Idempotent: it TRUNCATEs and re-inserts. Grows one section per domain as the
// build proceeds. Run with `npm run seed`.
import { Op } from 'sequelize';
import {
  sequelize,
  User,
  Video,
  Follow,
  FriendRequest,
  Block,
  Comment,
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
import type { GroupRole } from '@constants/enums';
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

const SAMPLE_CLIPS = [
  'https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/bipbop_4x3_variant.m3u8',
  'https://www.w3schools.com/html/mov_bbb.mp4',
  'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
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

export const seedVideos = async (userIds: string[]): Promise<string[]> => {
  const now = Date.now();
  const rows = Array.from({ length: 12 }, (_, i) => {
    const baseLikes = 120 + i * 37;
    const username = USERNAMES[i % USERNAMES.length]!;
    const createdAt = new Date(now - i * 3_600_000);
    return {
      author_id: userIds[i % userIds.length]!,
      hls_url: SAMPLE_CLIPS[i % SAMPLE_CLIPS.length]!,
      thumbnail_url: thumbFor(`video-${i + 1}`),
      caption: CAPTIONS[i % CAPTIONS.length]!,
      duration_ms: 18_000 + (i % 4) * 4_000,
      sound_name: i % 3 === 0 ? `original sound — ${username}` : null,
      like_count: baseLikes,
      dislike_count: Math.floor(baseLikes * 0.04),
      save_count: Math.floor(baseLikes * 0.2),
      comment_count: 0, // set to the real total after comments are seeded
      share_count: 2 + (i % 5),
      created_at: createdAt,
      updated_at: createdAt,
    };
  });
  const created = await Video.bulkCreate(rows, { returning: true });
  return created.map(v => v.video_id);
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

// Seed the COMMENT_SEEDS threads on every video, then reconcile each video's
// comment_count to the true total (top-level + replies).
export const seedComments = async (
  userIds: string[],
  videoIds: string[]
): Promise<void> => {
  const n = userIds.length;
  let author = 0;
  const now = Date.now();

  for (const videoId of videoIds) {
    const topRows = COMMENT_SEEDS.map((seed, i) => ({
      video_id: videoId,
      author_id: userIds[author++ % n]!,
      parent_id: null,
      body: seed.body,
      like_count: seed.likes,
      created_at: new Date(now - (i + 1) * 1_800_000),
    }));
    const created = await Comment.bulkCreate(topRows, { returning: true });

    const replyRows: CommentCreationAttributes[] = [];
    COMMENT_SEEDS.forEach((seed, i) => {
      const parent = created[i]!;
      const parentAt = new Date(now - (i + 1) * 1_800_000).getTime();
      seed.replies.forEach((reply, j) => {
        replyRows.push({
          video_id: videoId,
          author_id: userIds[author++ % n]!,
          parent_id: parent.comment_id,
          body: reply.body,
          like_count: reply.likes,
          created_at: new Date(parentAt + (j + 1) * 300_000),
        });
      });
    });
    if (replyRows.length) {
      await Comment.bulkCreate(replyRows);
    }

    await Video.update(
      { comment_count: topRows.length + replyRows.length },
      { where: { video_id: videoId } }
    );
  }
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
  await seedComments(userIds, videoIds);
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
