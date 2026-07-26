import { Op } from 'sequelize';
import { sequelize } from '@config/db';
import Appeal from '@models/moderation/Appeal';
import User from '@models/user/User';
import Video from '@models/feed/Video';
import Post from '@models/feed/Post';
import PostMedia from '@models/feed/PostMedia';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '@middlewares/error';
import { ERROR_CODES } from '@constants/errorCodes';
import type {
  AppealDecision,
  AppealStatus,
  AppealTargetType,
} from '@constants/enums';
import {
  serializeVideoTarget,
  serializeUserTarget,
  serializePostTarget,
  type ResolvedTarget,
} from '@serializers/moderationSerializer';
import {
  serializeAppeal,
  type AppealJSON,
  type AppealDetailJSON,
} from '@serializers/appealSerializer';
import { decodeCursor, encodeCursor, keysetWhere, clampPageSize } from '@utils/cursor';

const PAGE = 20;

// A user can only ever have one open appeal per target — a second submission
// while one is pending is a silent no-op (the moderator already has it).
const hasPendingAppeal = async (
  userId: string,
  targetType: AppealTargetType,
  targetId: string
): Promise<boolean> => {
  const existing = await Appeal.findOne({
    where: { user_id: userId, target_type: targetType, target_id: targetId, status: 'pending' },
  });
  return existing !== null;
};

/**
 * File an appeal from an authenticated (still-active) user. In practice this is
 * the removed-video path: a suspended user can't authenticate, so their
 * suspension appeal comes through `createSuspensionAppeal` instead.
 *
 * Ownership is enforced against the ACTUAL target so a user can't appeal
 * someone else's removal: for a video the appellant must be its author and the
 * video must actually be removed; for a user the target must be themselves.
 */
export const createAppeal = async (
  userId: string,
  input: { target_type: AppealTargetType; target_id: string; reason: string }
): Promise<void> => {
  if (input.target_type === 'video') {
    // paranoid:false — the whole point is that it was (soft-)removed.
    const video = await Video.findByPk(input.target_id, { paranoid: false });
    if (!video) throw new NotFoundError('Video');
    if (video.author_id !== userId) {
      throw new ForbiddenError('You can only appeal your own content');
    }
    if (video.deleted_at === null) {
      throw new BadRequestError('This video has not been removed');
    }
  } else if (input.target_type === 'post') {
    // Same ownership rule as video: your own post, and only if it was removed.
    const post = await Post.findByPk(input.target_id, { paranoid: false });
    if (!post) throw new NotFoundError('Post');
    if (post.author_id !== userId) {
      throw new ForbiddenError('You can only appeal your own content');
    }
    if (post.deleted_at === null) {
      throw new BadRequestError('This post has not been removed');
    }
  } else {
    // 'user' — you can only appeal your OWN account, and only if it's suspended.
    if (input.target_id !== userId) {
      throw new ForbiddenError('You can only appeal your own suspension');
    }
    const user = await User.findByPk(userId);
    if (user && user.is_active) {
      throw new BadRequestError('Your account is not suspended', ERROR_CODES.NOT_SUSPENDED);
    }
  }

  if (await hasPendingAppeal(userId, input.target_type, input.target_id)) return;

  await Appeal.create({
    user_id: userId,
    target_type: input.target_type,
    target_id: input.target_id,
    reason: input.reason,
  });
};

/**
 * File a suspension appeal WITHOUT a session. A suspended account is locked out
 * of login (authService rejects an inactive user), so the appellant proves who
 * they are with their credentials instead of a token. Only a genuinely
 * suspended account can appeal — active credentials have nothing to contest.
 */
export const createSuspensionAppeal = async (input: {
  email: string;
  password: string;
  reason: string;
}): Promise<void> => {
  const email = input.email.trim().toLowerCase();
  const user = await User.findOne({ where: { email } });
  // Uniform failure for bad email OR bad password — never reveal which.
  if (!user || !(await user.matchPassword(input.password))) {
    throw new UnauthorizedError('Invalid email or password', ERROR_CODES.INVALID_CREDENTIALS);
  }
  if (user.is_active) {
    throw new BadRequestError('Your account is not suspended', ERROR_CODES.NOT_SUSPENDED);
  }

  if (await hasPendingAppeal(user.user_id, 'user', user.user_id)) return;

  await Appeal.create({
    user_id: user.user_id,
    target_type: 'user',
    target_id: user.user_id,
    reason: input.reason,
  });
};

// ── Admin surface ────────────────────────────────────────────────────────────
export interface ListAppealsFilter {
  status?: AppealStatus;
  targetType?: AppealTargetType;
}

/** The appeals queue — newest first, cursor-paginated, filterable. */
export const listAppeals = async (
  filter: ListAppealsFilter,
  rawCursor?: string,
  rawLimit?: string
): Promise<{ items: AppealJSON[]; nextCursor: string | null }> => {
  const cursor = decodeCursor(rawCursor);
  const limit = clampPageSize(rawLimit, PAGE);

  const rows = await Appeal.findAll({
    where: {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.targetType ? { target_type: filter.targetType } : {}),
      ...keysetWhere(cursor, 'appeal_id'),
    },
    order: [
      ['created_at', 'DESC'],
      ['appeal_id', 'DESC'],
    ],
    limit: limit + 1,
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const userIds = [...new Set(page.map(a => a.user_id))];
  const appellants = userIds.length
    ? await User.findAll({ where: { user_id: { [Op.in]: userIds } } })
    : [];
  const byId = new Map(appellants.map(u => [u.user_id, u]));

  const items = page.map(a => serializeAppeal(a, byId.get(a.user_id)));
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor({ ts: last.created_at.toISOString(), id: last.appeal_id })
      : null;

  return { items, nextCursor };
};

// Resolve an appeal's polymorphic target for the detail view. paranoid:false so
// a removed video still shows (removed:true). A gone target resolves to null.
const hydrateTarget = async (
  targetType: AppealTargetType,
  targetId: string
): Promise<ResolvedTarget> => {
  if (targetType === 'video') {
    const v = await Video.findByPk(targetId, { paranoid: false });
    return v ? serializeVideoTarget(v) : null;
  }
  if (targetType === 'post') {
    const p = await Post.findByPk(targetId, { paranoid: false });
    if (!p) return null;
    const firstMedia = await PostMedia.findOne({
      where: { post_id: targetId },
      order: [['position', 'ASC']],
    });
    return serializePostTarget(p, firstMedia?.thumbnail_url ?? firstMedia?.url ?? null);
  }
  const u = await User.findByPk(targetId, { paranoid: false });
  return u ? serializeUserTarget(u) : null;
};

export const getAppeal = async (appealId: string): Promise<AppealDetailJSON> => {
  const appeal = await Appeal.findByPk(appealId);
  if (!appeal) throw new NotFoundError('Appeal');
  const appellant = await User.findByPk(appeal.user_id);
  const target = await hydrateTarget(appeal.target_type, appeal.target_id);
  return { ...serializeAppeal(appeal, appellant), target };
};

export interface ResolveAppealInput {
  adminId: string;
  appeal_id: string;
  decision: AppealDecision;
  note?: string;
}

/**
 * Resolve one appeal. Unlike report resolution (which collapses every report
 * against a target), an appeal is an individual case, so this operates on the
 * single appeal. Granting REVERSES the original moderation action — reactivate a
 * suspended user, restore a removed video — inside the same transaction that
 * marks the appeal granted, so a failed reversal never leaves a granted appeal
 * whose action didn't actually un-happen.
 */
export const resolveAppeal = async (
  input: ResolveAppealInput
): Promise<{ appeal_id: string; status: AppealStatus; decision: AppealDecision }> => {
  const appeal = await Appeal.findByPk(input.appeal_id);
  if (!appeal) throw new NotFoundError('Appeal');
  if (appeal.status !== 'pending') {
    throw new BadRequestError('This appeal has already been resolved');
  }

  return sequelize.transaction(async transaction => {
    if (input.decision === 'grant') {
      if (appeal.target_type === 'user') {
        const u = await User.findByPk(appeal.target_id, { transaction });
        if (u) await u.update({ is_active: true }, { transaction });
      } else if (appeal.target_type === 'post') {
        // post — restore the soft-deleted row if it's still restorable.
        const p = await Post.findByPk(appeal.target_id, {
          paranoid: false,
          transaction,
        });
        if (p && p.deleted_at !== null) await p.restore({ transaction });
      } else {
        // video — restore the soft-deleted row if it's still restorable.
        const v = await Video.findByPk(appeal.target_id, {
          paranoid: false,
          transaction,
        });
        if (v && v.deleted_at !== null) await v.restore({ transaction });
      }
    }

    const status: AppealStatus = input.decision === 'grant' ? 'granted' : 'denied';
    await appeal.update(
      {
        status,
        reviewed_by: input.adminId,
        reviewed_at: new Date(),
        resolution_note: input.note ?? null,
      },
      { transaction }
    );

    return { appeal_id: appeal.appeal_id, status, decision: input.decision };
  });
};
