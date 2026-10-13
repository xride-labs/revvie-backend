import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { McpToolDefinition, ToolContext } from "../types.js";

export const getMyProfileSchema = z.object({});

export async function getMyProfileHandler(_args: {}, context: ToolContext) {
  if (!context?.userId) {
    throw new Error("Unauthorized: Active user session required.");
  }
  const user = await prisma.user.findUnique({
    where: { id: context.userId },
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
      level: true,
      levelTitle: true,
      xpPoints: true,
      location: true,
      bio: true,
    },
  });
  if (!user) throw new Error("User not found");
  return { success: true, profile: user };
}

export const getMyGarageSchema = z.object({});

export async function getMyGarageHandler(_args: {}, context: ToolContext) {
  if (!context?.userId) {
    throw new Error("Unauthorized: Active user session required.");
  }
  const bikes = await prisma.bike.findMany({
    where: { userId: context.userId },
    include: { bikeModel: { include: { manufacturer: true } } },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });

  return {
    success: true,
    count: bikes.length,
    bikes: bikes.map((b) => ({
      id: b.id,
      nickname: b.nickname,
      make: b.make || b.bikeModel?.manufacturer?.name,
      model: b.model || b.bikeModel?.name,
      year: b.year,
      engineCc: b.engineCc ?? b.bikeModel?.engineCc,
      isPrimary: b.isPrimary,
    })),
  };
}

export const getMyProfileTool: McpToolDefinition<typeof getMyProfileSchema> = {
  name: "get_my_profile",
  description: "Get the profile, experience level, and XP of the current logged-in user",
  schema: getMyProfileSchema,
  handler: getMyProfileHandler,
};

export const getMyGarageTool: McpToolDefinition<typeof getMyGarageSchema> = {
  name: "get_my_garage",
  description: "Get the motorcycles in the current user's garage",
  schema: getMyGarageSchema,
  handler: getMyGarageHandler,
};
