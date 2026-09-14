import { Request, Response } from "express";
import { ClubService } from "../services/club/club.service.js";
import { ApiResponse, ErrorCode } from "../lib/utils/apiResponse.js";
import { isUserPro, countUserOwnedClubs, FREE_CLUB_OWNERSHIP_LIMIT, FREE_CLUBS_JOINED_LIMIT } from "../lib/subscription.js";

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

  static async getJoinRequests(req: Request, res: Response) {
    const { id } = req.params;
    const session = (req as any).session;
    const status = (req.query.status as string) || "PENDING";
    const data = await ClubService.getJoinRequests(id, session.user.id, status as any);
    ApiResponse.success(res, data);
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
    const session = req.session!;
    const hasPro = await isUserPro(session.user.id);
    if (!hasPro) {
      const ownedCount = await countUserOwnedClubs(session.user.id);
      if (ownedCount >= FREE_CLUB_OWNERSHIP_LIMIT) {
        return ApiResponse.forbidden(
          res,
          `Free users can own up to ${FREE_CLUB_OWNERSHIP_LIMIT} clubs. Upgrade to Revvie Pro to create more.`,
          ErrorCode.SUBSCRIPTION_REQUIRED,
        );
      }
    }

    const club = await ClubService.createClub(req.body, session.user.id);
    import("../services/club/groupChat.service.js").then((m) => {
      m.ensureAnnouncementsGroup(club.id).catch(console.error);
    });
    ApiResponse.created(res, { club }, "Club created successfully");
  }

  static async updateClub(req: Request, res: Response) {
    const { id } = req.params;
    try {
      const club = await ClubService.updateClub(id, req.body);
      ApiResponse.success(res, { club }, "Club updated successfully");
    } catch (err: any) {
      ApiResponse.error(res, err.message, 400);
    }
  }

  static async joinClub(req: Request, res: Response) {
    const session = (req as any).session;
    const { id } = req.params;
    try {
      const result = await ClubService.joinClub(id, session.user.id, req.body.message, req.body.answers);
      
      if (result.requiresApproval || result.isPrivate) {
        import("../lib/notifications.js").then(async ({ notifyUsers }) => {
          const clubAdmins = await import("../lib/prisma.js").then(m => m.default.clubMember.findMany({
            where: { clubId: id, role: { slug: { in: ["admin", "owner", "founder"] } } },
            select: { userId: true },
          }));
          const approverIds = Array.from(new Set([result.club.ownerId, ...clubAdmins.map(a => a.userId)])).filter(uId => uId !== session.user.id);
          
          await notifyUsers(approverIds, {
            type: "CLUB_REQUEST",
            title: `New request to join ${result.club.name}`,
            message: `A rider submitted an application to join your club.`,
            relatedType: "club",
            relatedId: id,
          });
        });
        return ApiResponse.created(res, { joinRequest: result.joinRequest }, "Application submitted — waiting for club review");
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
      if (err.message === "INVITE_ONLY") return ApiResponse.forbidden(res, "This club is private and invite-only");
      if (err.message === "JOIN_LIMIT_REACHED")
        return ApiResponse.forbidden(
          res,
          `Free users can join up to ${FREE_CLUBS_JOINED_LIMIT} clubs. Upgrade to Revvie Pro to join more.`,
          ErrorCode.SUBSCRIPTION_REQUIRED,
        );
      throw err;
    }
  }

  static async deleteClub(req: Request, res: Response) {
    const { id } = req.params;
    try {
      await ClubService.deleteClub(id);
      ApiResponse.success(res, null, "Club deleted successfully");
    } catch {
      ApiResponse.error(res, "Failed to delete club", 500);
    }
  }

  // ── Join Flow Configuration ──
  static async getJoinFlow(req: Request, res: Response) {
    const { id } = req.params;
    const club = await (await import("../lib/prisma.js")).default.club.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        joinPolicy: true,
        joinQuestions: true,
        isPublic: true,
        requiresLicense: true,
      },
    });

    if (!club) return ApiResponse.notFound(res, "Club not found");
    ApiResponse.success(res, { joinFlow: club });
  }

  static async updateJoinFlow(req: Request, res: Response) {
    const { id } = req.params;
    const { joinPolicy, joinQuestions, isPublic, requiresLicense } = req.body;

    const data: any = {};
    if (joinPolicy !== undefined) data.joinPolicy = joinPolicy;
    if (joinQuestions !== undefined) data.joinQuestions = joinQuestions;
    if (isPublic !== undefined) data.isPublic = isPublic;
    if (requiresLicense !== undefined) data.requiresLicense = requiresLicense;

    const club = await (await import("../lib/prisma.js")).default.club.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        joinPolicy: true,
        joinQuestions: true,
        isPublic: true,
        requiresLicense: true,
      },
    });

    ApiResponse.success(res, { joinFlow: club }, "Join flow updated successfully");
  }

  // ── Custom Roles & Permissions ──
  static async getClubRoles(req: Request, res: Response) {
    const { id } = req.params;
    const { RolesService } = await import("../services/roles.service.js");
    const roles = await RolesService.listClubRoles(id);
    ApiResponse.success(res, { roles });
  }

  static async getClubPermissions(req: Request, res: Response) {
    const { RolesService } = await import("../services/roles.service.js");
    const permissions = await RolesService.listClubPermissions();
    ApiResponse.success(res, { permissions });
  }

  static async createClubRole(req: Request, res: Response) {
    const { id } = req.params;
    const { RolesService } = await import("../services/roles.service.js");
    const { name, description, color, icon, permissionCodes } = req.body;

    if (!name || !permissionCodes || !Array.isArray(permissionCodes)) {
      return ApiResponse.error(res, "Role name and permissionCodes array are required", 400);
    }

    const role = await RolesService.createClubRole(id, {
      name,
      description,
      color,
      icon,
      permissionCodes,
    });

    ApiResponse.created(res, { role }, "Custom role created successfully");
  }

  static async updateClubRole(req: Request, res: Response) {
    const { id, roleId } = req.params;
    const { RolesService } = await import("../services/roles.service.js");
    const { name, description, color, icon, permissionCodes } = req.body;

    const role = await RolesService.updateClubRole(id, roleId, {
      name,
      description,
      color,
      icon,
      permissionCodes,
    });

    ApiResponse.success(res, { role }, "Role updated successfully");
  }

  static async deleteClubRole(req: Request, res: Response) {
    const { id, roleId } = req.params;
    const { RolesService } = await import("../services/roles.service.js");

    await RolesService.deleteClubRole(id, roleId);
    ApiResponse.success(res, null, "Role deleted successfully");
  }

  static async assignClubMemberRole(req: Request, res: Response) {
    const { id, userId } = req.params;
    const { roleId } = req.body;
    const { RolesService } = await import("../services/roles.service.js");

    const member = await RolesService.assignClubMemberRole(id, userId, roleId ?? null);
    ApiResponse.success(res, { member }, "Member role updated successfully");
  }
}
