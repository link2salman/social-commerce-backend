import { z } from 'zod';
import { GROUP_ROLES } from '@constants/enums';

// POST /conversations/group — mirrors GroupInputSchema (my own id is implicit).
export const groupInputSchema = z.object({
  title: z.string().trim().min(1),
  participant_ids: z.array(z.string().uuid()).min(2),
});

// POST /conversations/:id/members
export const addMembersSchema = z.object({
  user_ids: z.array(z.string().uuid()).min(1),
});

// PATCH /conversations/:id/members/:userId
export const memberRoleSchema = z.object({
  role: z.enum(GROUP_ROLES),
});

// POST /conversations/:id/messages — mirrors MessageInputSchema (text, image, or both).
export const messageInputSchema = z
  .object({
    body: z.string().trim().max(2000).default(''),
    image_url: z.string().url().nullable().default(null),
  })
  .refine(v => v.body.length > 0 || v.image_url !== null, {
    message: 'A message must have text or an image',
  });

export type GroupInputBody = z.infer<typeof groupInputSchema>;
export type AddMembersBody = z.infer<typeof addMembersSchema>;
export type MemberRoleBody = z.infer<typeof memberRoleSchema>;
export type MessageInputBody = z.infer<typeof messageInputSchema>;
