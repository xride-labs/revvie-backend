import prisma from "../../lib/prisma.js";

export class RideService {
  static async getRides(params: any) {
    const { page, limit, status, experienceLevel, startDate, endDate, search } = params;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (status) where.status = status;
    if (experienceLevel) where.experienceLevel = experienceLevel;
    if (startDate || endDate) {
      where.scheduledAt = {};
      if (startDate) where.scheduledAt.gte = new Date(startDate);
      if (endDate) where.scheduledAt.lte = new Date(endDate);
    }
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        { startLocation: { contains: search, mode: "insensitive" } },
      ];
    }

    const [rides, total] = await Promise.all([
      prisma.ride.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          creator: { select: { id: true, name: true, avatar: true } },
          _count: { select: { participants: true } },
        },
      }),
      prisma.ride.count({ where }),
    ]);

    return { rides, total, totalPages: Math.ceil(total / limit) };
  }

  static async getRideById(id: string, userId: string | null) {
    const ride = await prisma.ride.findUnique({
      where: { id },
      include: {
        creator: { select: { id: true, name: true, avatar: true } },
        lead: { select: { id: true, name: true, avatar: true } },
        participants: { include: { user: { select: { id: true, name: true, avatar: true } } } },
      },
    });

    if (!ride) throw new Error("RIDE_NOT_FOUND");

    let participantStatus: string | null = null;
    let pendingRequestCount = 0;

    if (userId) {
      const myParticipation = (ride as any).participants.find((p: any) => p.user?.id === userId);
      participantStatus = myParticipation?.status || null;

      if (ride.creatorId === userId) {
        pendingRequestCount = (ride as any).participants.filter((p: any) => p.status === "REQUESTED").length;
      }
    }

    const isFavorite = userId
      ? Boolean(await prisma.savedRoute.findUnique({
          where: { userId_rideId: { userId, rideId: id } },
          select: { id: true },
        }))
      : false;

    return { ride, participantStatus, pendingRequestCount, isFavorite };
  }
}
