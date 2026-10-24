import { z } from "zod";

export const groupInfoSchema = z.object({
  name: z.string().trim().min(1, "群名不能为空").max(40, "群名最多 40 个字符"),
  description: z.string().trim().max(500, "简介最多 500 个字符").default(""),
});

export type InviteOutcome =
  | "added" // owner invited: joins immediately
  | "requested" // member invited: waits for owner approval
  | "already-member"
  | "already-pending"
  | "not-friend";

/**
 * What happens when `inviter` pulls a user into a group. Only friends can be
 * invited; the owner's invitations count as approved.
 */
export function inviteOutcome(input: {
  inviterIsOwner: boolean;
  isFriend: boolean;
  isMember: boolean;
  hasPendingRequest: boolean;
}): InviteOutcome {
  if (input.isMember) return "already-member";
  if (!input.isFriend) return "not-friend";
  if (input.inviterIsOwner) return "added";
  if (input.hasPendingRequest) return "already-pending";
  return "requested";
}
