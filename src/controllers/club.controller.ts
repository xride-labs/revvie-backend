import prisma from "../lib/prisma.js";
import { Request, Response } from "express";
import { ClubService } from "../services/club/club.service.js";
import { ApiResponse } from "../lib/utils/apiResponse.js";

export class ClubController {
  static async getClubs(req: Request, res: Response) {
    const params = req.query as any;
    const data = await ClubService.getClubs(params);
    ApiResponse.paginated(res, data.clubs, {
      page: params.page,
      limit: params.limit,
      total: data.total,
      totalPages: data.totalPages,
    });
  }

  static async getMyClubs(req: Request, res: Response) {
    const session = (req as any).session;
    const params = req.query as any;
    const data = await ClubService.getMyClubs(session.user.id, params);
    ApiResponse.paginated(res, data.clubs, {
      page: params.page,
      limit: params.limit,
      total: data.total,
      totalPages: data.totalPages,
    });
  }

  static async discoverClubs(req: Request, res: Response) {
    const session = (req as any).session;
    const params = req.query as any;
    const data = await ClubService.discoverClubs(session.user.id, params);
    ApiResponse.success(res, data);
  }

  static async getClubById(req: Request, res: Response) {
    const { id } = req.params;
    const session = (req as any).session;
    try {
      const club = await ClubService.getClubById(id, session?.user?.id);
      ApiResponse.success(res, { club });
    } catch (err: any) {
      if (err.message === "CLUB_NOT_FOUND") return ApiResponse.notFound(res, "Club not found", "CLUB_NOT_FOUND");
      throw err;
    }
  }

  static async getClubRides(req: Request, res: Response) {
    const { id } = req.params;
    const session = (req as any).session;
    const params = req.query as any;
    try {
      const data = await ClubService.getClubRides(id, session.user.id, params);
      ApiResponse.paginated(res, data.rides, {
        page: params.page,
        limit: params.limit,
        total: data.total,
        totalPages: data.totalPages,
      });
    } catch (err: any) {
      if (err.message === "CLUB_NOT_FOUND") return ApiResponse.notFound(res, "Club not found", "CLUB_NOT_FOUND");
      if (err.message === "NOT_A_MEMBER") return ApiResponse.forbidden(res, "You are not a member of this private club");
      throw err;
    }
  }

  static async createClub(req: Request, res: Response) {
    const session = (req as any).session;
    try {
      const club = await ClubService.createClub(req.body, session.user.id);
      import("../services/club/groupChat.service.js").then((m) => {
        m.ensureAnnouncementsGroup(club.id).catch(console.error);
      });
      ApiResponse.created(res, { club }, "Club created successfully");
    } catch (err: any) {
      throw err;
    }
  }

  static async updateClub(req: Request, res: Response) {
    const { id } = req.params;
    try {
      await ClubService.updateClub(id, req.body);
      ApiResponse.success(res, null, "Club updated successfully");
    } catch (err: any) {
      ApiResponse.error(res, err.message, 400);
    }
  }

  static async joinClub(req: Request, res: Response) {
    const session = (req as any).session;
    const { id } = req.params;
    try {
      const result = await ClubService.joinClub(id, session.user.id, req.body.message);
      
      if (result.isPrivate) {
        import("../lib/notifications.js").then(async ({ notifyUsers }) => {
          const clubAdmins = await import("../lib/prisma.js").then(m => m.default.clubMember.findMany({
            where: { clubId: id, role: { in: ["ADMIN", "FOUNDER"] } },
            select: { userId: true },
          }));
          const approverIds = Array.from(new Set([result.club.ownerId, ...clubAdmins.map(a => a.userId)])).filter(uId => uId !== session.user.id);
          
          await notifyUsers(approverIds, {
            type: "CLUB_REQUEST",
            title: `New request to join ${result.club.name}`,
            message: `A rider requested to join your club community.`,
            relatedType: "club",
            relatedId: id,
          });
        });
        return ApiResponse.created(res, { joinRequest: result.joinRequest }, "Join request sent — waiting for admin approval");
      }

      import("../services/club/groupChat.service.js").then((m) => {
        m.addClubMemberToAnnouncements(id, session.user.id).catch(console.error);
      });
      ApiResponse.created(res, { membership: result.membership }, "Joined club successfully");
    } catch (err: any) {
      if (err.message === "CLUB_NOT_FOUND") return ApiResponse.notFound(res, "Club not found", "CLUB_NOT_FOUND");
      if (err.message === "BANNED") return ApiResponse.forbidden(res, "You are banned from this community");
      if (err.message === "ALREADY_MEMBER") return ApiResponse.conflict(res, "You are already a member of this club");
      if (err.message === "PENDING_REQUEST") return ApiResponse.conflict(res, "You already have a pending join request");
      throw err;
    }
  }

  static async deleteClub(req: Request, res: Response) {
    const { id } = req.params;
    try {
      await ClubService.deleteClub(id);
      ApiResponse.success(res, null, "Club deleted successfully");
    } catch (err: any) {
      ApiResponse.error(res, "Failed to delete club", 500);
    }
  }
}
