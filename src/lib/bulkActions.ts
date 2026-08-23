import { z } from "zod";
import prisma from "./prisma.js";
import { ApiResponse, ErrorCode } from "./utils/apiResponse.js";

export const BulkActionSchema = z.object({
  module: z.enum([
    "clubs",
    "club-join-requests",
    "ride-participants",
    "businesses",
    "ad-campaigns",
    "club-member-requests", // For club managers
    "brand-campaigns", // For brand managers
    "brand-products", // For brand managers — their own product catalogue
  ]),
  action: z.enum([
    "approve",
    "reject",
    "verify",
    "accept",
    "decline",
    "delete",
    "feature",
    "unfeature",
    "hide",
    "show",
  ]),
  ids: z.array(z.string().min(1)).min(1).max(500),
  data: z.record(z.string(), z.any()).optional(), // Additional data like notes
});

export type BulkActionInput = z.infer<typeof BulkActionSchema>;

export interface BulkActionResult {
  success: boolean;
  processed: number;
  failed: number;
  errors?: Array<{ id: string; error: string }>;
}

export async function processBulkAction(
  input: BulkActionInput,
  context: { userId?: string; userRoles?: string[] }
): Promise<BulkActionResult> {
  const { module, action, ids, data } = input;
  const errors: Array<{ id: string; error: string }> = [];
  let processed = 0;

  try {
    switch (module) {
      case "clubs":
        if (action === "verify") {
          const result = await prisma.club.updateMany({
            where: { id: { in: ids } },
            data: { verified: true },
          });
          processed = result.count;
        }
        break;

      case "club-join-requests":
        if (action === "approve") {
          const requests = await prisma.clubJoinRequest.findMany({
            where: { id: { in: ids }, status: "PENDING" },
            select: { id: true, clubId: true, userId: true },
          });

          await prisma.$transaction(async (tx) => {
            await tx.clubJoinRequest.updateMany({
              where: { id: { in: requests.map((r) => r.id) } },
              data: { status: "APPROVED" },
            });
            
            for (const r of requests) {
              await tx.clubMember.upsert({
                where: { clubId_userId: { clubId: r.clubId, userId: r.userId } },
                create: { userId: r.userId, clubId: r.clubId, role: "MEMBER" },
                update: {},
              });
            }
          });
          processed = requests.length;
        } else if (action === "reject") {
          const result = await prisma.clubJoinRequest.updateMany({
            where: { id: { in: ids }, status: "PENDING" },
            data: { status: "REJECTED" },
          });
          processed = result.count;
        }
        break;

      case "ride-participants":
        if (action === "accept") {
          const result = await prisma.rideParticipant.updateMany({
            where: { id: { in: ids }, status: "REQUESTED" },
            data: { status: "ACCEPTED" },
          });
          processed = result.count;
        } else if (action === "decline") {
          const result = await prisma.rideParticipant.updateMany({
            where: { id: { in: ids }, status: "REQUESTED" },
            data: { status: "DECLINED" },
          });
          processed = result.count;
        }
        break;

      case "businesses":
        if (action === "approve") {
          const result = await prisma.businessProfile.updateMany({
            where: { id: { in: ids }, verification: "SUBMITTED" },
            data: { verification: "APPROVED" },
          });
          processed = result.count;
        } else if (action === "reject") {
          const result = await prisma.businessProfile.updateMany({
            where: { id: { in: ids }, verification: "SUBMITTED" },
            data: { 
              verification: "REJECTED",
              verificationNotes: data?.notes || null,
            },
          });
          processed = result.count;
        }
        break;

      case "ad-campaigns":
        if (action === "approve") {
          const result = await prisma.adCampaign.updateMany({
            where: { id: { in: ids }, status: "PENDING_APPROVAL" },
            data: { status: "ACTIVE" },
          });
          processed = result.count;
        } else if (action === "reject") {
          const result = await prisma.adCampaign.updateMany({
            where: { id: { in: ids }, status: "PENDING_APPROVAL" },
            data: { 
              status: "REJECTED",
              reviewNotes: data?.notes || null,
            },
          });
          processed = result.count;
        }
        break;

      case "club-member-requests":
        // For club managers - they can only manage requests for clubs they own/manage
        if (action === "approve" || action === "reject") {
          const clubManagerId = context.userId;
          if (!clubManagerId) {
            throw new Error("User ID required for club manager actions");
          }

          // Get clubs owned/managed by this user
          const managedClubs = await prisma.club.findMany({
            where: {
              OR: [
                { ownerId: clubManagerId },
                { members: { some: { userId: clubManagerId, role: { in: ["ADMIN", "FOUNDER"] } } } },
              ],
            },
            select: { id: true },
          });
          
          const managedClubIds = managedClubs.map(c => c.id);

          const requests = await prisma.clubJoinRequest.findMany({
            where: { 
              id: { in: ids },
              status: "PENDING",
              clubId: { in: managedClubIds },
            },
            select: { id: true, clubId: true, userId: true },
          });

          if (action === "approve") {
            await prisma.$transaction(async (tx) => {
              await tx.clubJoinRequest.updateMany({
                where: { id: { in: requests.map((r) => r.id) } },
                data: { status: "APPROVED" },
              });
              
              for (const r of requests) {
                await tx.clubMember.upsert({
                  where: { clubId_userId: { clubId: r.clubId, userId: r.userId } },
                  create: { userId: r.userId, clubId: r.clubId, role: "MEMBER" },
                  update: {},
                });
              }
            });
          } else if (action === "reject") {
            await prisma.clubJoinRequest.updateMany({
              where: { id: { in: requests.map((r) => r.id) } },
              data: { status: "REJECTED" },
            });
          }
          
          processed = requests.length;
        }
        break;

      case "brand-campaigns":
        // For brand managers - they can only manage campaigns for brands they own/manage
        if (action === "approve" || action === "reject") {
          const brandManagerId = context.userId;
          if (!brandManagerId) {
            throw new Error("User ID required for brand manager actions");
          }

          // Get brands owned by this user
          const managedBrands = await prisma.businessProfile.findMany({
            where: {
              ownerId: brandManagerId,
            },
            select: { id: true },
          });
          
          const managedBrandIds = managedBrands.map(b => b.id);

          const campaigns = await prisma.adCampaign.findMany({
            where: { 
              id: { in: ids },
              status: "PENDING_APPROVAL",
              businessId: { in: managedBrandIds },
            },
            select: { id: true },
          });

          if (action === "approve") {
            const result = await prisma.adCampaign.updateMany({
              where: { id: { in: campaigns.map((c) => c.id) } },
              data: { status: "ACTIVE" },
            });
            processed = result.count;
          } else if (action === "reject") {
            const result = await prisma.adCampaign.updateMany({
              where: { id: { in: campaigns.map((c) => c.id) } },
              data: { 
                status: "REJECTED",
                reviewNotes: data?.notes || null,
              },
            });
            processed = result.count;
          }
        }
        break;

      case "brand-products":
        // For brand managers — bulk-manage their OWN product catalogue only.
        {
          const ownerId = context.userId;
          if (!ownerId) {
            throw new Error("User ID required for brand product actions");
          }
          const brands = await prisma.businessProfile.findMany({
            where: { ownerId },
            select: { id: true },
          });
          const brandIds = brands.map((b) => b.id);
          const where = { id: { in: ids }, businessId: { in: brandIds } };

          if (action === "delete") {
            const result = await prisma.brandProduct.deleteMany({ where });
            processed = result.count;
          } else if (action === "feature" || action === "unfeature") {
            const result = await prisma.brandProduct.updateMany({
              where,
              data: { isFeatured: action === "feature" },
            });
            processed = result.count;
          } else if (action === "hide" || action === "show") {
            const result = await prisma.brandProduct.updateMany({
              where,
              data: { isActive: action === "show" },
            });
            processed = result.count;
          }
        }
        break;

      default:
        throw new Error(`Unsupported module: ${module}`);
    }

    return {
      success: true,
      processed,
      failed: errors.length,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (error) {
    console.error("Bulk action failed:", error);
    throw error;
  }
}