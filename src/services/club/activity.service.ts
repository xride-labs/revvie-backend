import prisma from "../../lib/prisma.js";

/**
 * Best-effort club activity tracker. Called from the chat send path: if the
 * conversation backs a club FriendGroup, bump the sender's ClubMember
 * activity counters that the web club-admin dashboard surfaces.
 *
 * Intentionally dependency-free (only prisma) so chat.service can import it
 * without creating a cycle with clubGroupChat.service.
 */
export async function recordClubMessageActivity(
  conversationId: string,
  userId: string,
): Promise<void> {
  try {
    if (!userId || userId === "system") return;
    const group = await prisma.friendGroup.findFirst({
      where: { conversationId },
      select: { clubId: true },
    });
    if (!group?.clubId) return;
    const now = new Date();
    await prisma.clubMember.updateMany({
      where: { clubId: group.clubId, userId },
      data: {
        lastMessageAt: now,
        lastInteractionAt: now,
        messageCount: { increment: 1 },
      },
    });
  } catch (err) {
    console.error("[clubActivity] recordClubMessageActivity failed:", err);
  }
}
