import { Router, Request, Response } from "express";
import { z } from "zod";
import crypto from "crypto";
import { ApiResponse, ErrorCode } from "../../lib/utils/apiResponse.js";
import { requireAuth } from "../../config/auth.js";
import { validateBody, validateParams, asyncHandler } from "../../middlewares/validation.js";
import prisma from "../../lib/prisma.js";
import { isStaff } from "../../lib/utils/permissions.js";
import { sendEmail } from "../../lib/mailer.js";
import { buildEventBookingConfirmationTemplate } from "../../lib/emailTemplates.js";

const router = Router();
router.use(requireAuth);

const idParamSchema = z.object({ id: z.string().cuid() });

const createTicketTierSchema = z.object({
  name: z.string().min(2).max(60),
  description: z.string().max(300).optional(),
  price: z.number().nonnegative().default(0),
  quantity: z.number().int().positive().default(100),
  maxPerUser: z.number().int().positive().default(5),
});

const createEventSchema = z.object({
  title: z.string().min(3).max(120),
  description: z.string().max(3000).optional(),
  location: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  scheduledAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  clubId: z.string().cuid().optional(),
  bannerImage: z.string().optional(),
  ticketUrl: z.string().url().optional().or(z.literal("")),
  visibility: z.enum(["PUBLIC", "CLUB_ONLY", "PRIVATE"]).default("PUBLIC"),
  category: z.string().optional().default("MEETUP"),
  price: z.number().nonnegative().optional().default(0),
  maxAttendees: z.number().int().positive().optional(),
  tiers: z.array(createTicketTierSchema).optional(),
});

const updateEventSchema = createEventSchema.partial();

const bookTicketSchema = z.object({
  tierId: z.string().cuid().optional(),
  quantity: z.number().int().min(1).max(10).default(1),
  paymentMethod: z.enum(["UPI", "CASH", "FREE"]).default("FREE"),
  upiTransactionRef: z.string().max(100).optional(),
});

const validateTicketSchema = z.object({
  ticketCode: z.string().min(4).max(100),
});

// Helper to generate unique order number (e.g. REV-EVT-938201)
function generateOrderNumber(): string {
  const rand = Math.floor(100000 + Math.random() * 900000);
  return `REV-EVT-${rand}`;
}

// Helper to generate unique ticket token (e.g. TKT-REV-XXXX-XXXX)
function generateTicketCode(): string {
  const token = crypto.randomBytes(4).toString("hex").toUpperCase();
  const sub = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `TKT-REV-${token}-${sub}`;
}

// ── 1. Get Logged-in User's Event Tickets (Pass Wallet) ──
router.get(
  "/my-tickets",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.session!.user.id;

    const tickets = await prisma.eventTicket.findMany({
      where: { userId },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            scheduledAt: true,
            endedAt: true,
            location: true,
            bannerImage: true,
            category: true,
            club: { select: { id: true, name: true, image: true } },
            creator: { select: { id: true, name: true, avatar: true } },
          },
        },
        tier: { select: { id: true, name: true, price: true } },
        order: { select: { id: true, orderNumber: true, paymentMethod: true, totalAmount: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    ApiResponse.success(res, tickets, "My tickets retrieved successfully");
  })
);

// ── 2. Get All Events (Feed / Explorer) ──
router.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.session!.user.id;
    const {
      clubId,
      visibility,
      category,
      search,
      filter,
      timeframe = "upcoming",
      page = "1",
      limit = "30",
    } = req.query;

    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(String(limit), 10) || 30));
    const skip = (pageNum - 1) * limitNum;

    const where: any = {
      status: { not: "CANCELLED" },
    };

    const now = new Date();
    if (timeframe === "past") {
      where.scheduledAt = { lt: now };
    } else {
      where.scheduledAt = { gte: now };
    }

    if (category && typeof category === "string" && category !== "ALL") {
      where.category = category;
    }

    if (clubId && typeof clubId === "string") {
      where.clubId = clubId;
    }

    if (visibility && typeof visibility === "string") {
      where.visibility = visibility;
    }

    if (search && typeof search === "string" && search.trim()) {
      where.OR = [
        { title: { contains: search.trim(), mode: "insensitive" } },
        { description: { contains: search.trim(), mode: "insensitive" } },
        { location: { contains: search.trim(), mode: "insensitive" } },
      ];
    }

    if (filter === "my_rsvps") {
      where.participants = {
        some: { userId, status: "ACCEPTED" },
      };
    } else if (filter === "my_hosted") {
      where.creatorId = userId;
    } else if (filter === "featured") {
      where.isFeatured = true;
    } else if (filter === "club") {
      where.clubId = { not: null };
    }

    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where,
        include: {
          creator: {
            select: { id: true, name: true, avatar: true, username: true },
          },
          club: {
            select: { id: true, name: true, image: true, memberCount: true },
          },
          ticketTiers: {
            select: { id: true, name: true, price: true, availableQuantity: true },
          },
          participants: {
            where: { userId },
            select: { status: true },
          },
          _count: {
            select: { participants: true, tickets: true },
          },
        },
        orderBy: { scheduledAt: timeframe === "past" ? "desc" : "asc" },
        skip,
        take: limitNum,
      }),
      prisma.event.count({ where }),
    ]);

    const formatted = events.map((event) => {
      const userParticipation = event.participants[0]?.status;
      return {
        ...event,
        isAttending: userParticipation === "ACCEPTED",
        isHost: event.creatorId === userId,
        participantCount: event._count.participants,
        ticketsSold: event._count.tickets,
      };
    });

    ApiResponse.success(
      res,
      {
        events: formatted,
        total,
        page: pageNum,
        totalPages: Math.ceil(total / limitNum),
        hasMore: skip + events.length < total,
      },
      "Events retrieved successfully"
    );
  })
);

// ── 3. Get Single Event Details ──
router.get(
  "/:id",
  validateParams(idParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.session!.user.id;
    const { id } = req.params;

    const event = await prisma.event.findUnique({
      where: { id },
      include: {
        creator: {
          select: { id: true, name: true, avatar: true, username: true },
        },
        club: {
          select: { id: true, name: true, image: true, memberCount: true, ownerId: true },
        },
        ticketTiers: {
          orderBy: { price: "asc" },
        },
        participants: {
          include: {
            user: {
              select: { id: true, name: true, avatar: true, username: true },
            },
          },
          take: 50,
          orderBy: { createdAt: "asc" },
        },
        _count: {
          select: { participants: true, tickets: true, orders: true },
        },
      },
    });

    if (!event) {
      return ApiResponse.notFound(res, "Event not found");
    }

    const userParticipation = event.participants.find((p) => p.userId === userId);
    const userTickets = await prisma.eventTicket.findMany({
      where: { eventId: id, userId },
      include: { tier: true, order: true },
    });

    const isHost = event.creatorId === userId || event.club?.ownerId === userId;

    const formatted = {
      ...event,
      isAttending: userParticipation?.status === "ACCEPTED",
      isHost,
      participantCount: event._count.participants,
      ticketsSold: event._count.tickets,
      myTickets: userTickets,
      attendees: event.participants.map((p) => p.user),
    };

    ApiResponse.success(res, formatted, "Event details retrieved successfully");
  })
);

// ── 4. Host / Create an Event ──
router.post(
  "/",
  validateBody(createEventSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const data = req.body;
    const userId = req.session!.user.id;

    if (data.clubId) {
      const clubMember = await prisma.clubMember.findUnique({
        where: { clubId_userId: { clubId: data.clubId, userId } },
      });
      const club = await prisma.club.findUnique({ where: { id: data.clubId } });

      if (
        !club ||
        (club.ownerId !== userId &&
          clubMember?.role !== "OFFICER" &&
          !isStaff(req.session?.user?.roles))
      ) {
        return ApiResponse.forbidden(
          res,
          "Only club owners or officers can host an event for this club."
        );
      }
    }

    const eventRecord = await prisma.$transaction(async (tx) => {
      const created = await tx.event.create({
        data: {
          title: data.title,
          description: data.description,
          location: data.location,
          latitude: data.latitude,
          longitude: data.longitude,
          scheduledAt: new Date(data.scheduledAt),
          endedAt: data.endedAt ? new Date(data.endedAt) : undefined,
          clubId: data.clubId,
          bannerImage: data.bannerImage,
          ticketUrl: data.ticketUrl || undefined,
          visibility: data.visibility,
          category: data.category,
          price: data.price,
          maxAttendees: data.maxAttendees,
          creatorId: userId,
        },
      });

      // If tiers are provided, create them; otherwise create a default General Admission tier
      if (data.tiers && data.tiers.length > 0) {
        await tx.eventTicketTier.createMany({
          data: data.tiers.map((t: any) => ({
            eventId: created.id,
            name: t.name,
            description: t.description,
            price: t.price,
            quantity: t.quantity,
            availableQuantity: t.quantity,
            maxPerUser: t.maxPerUser,
          })),
        });
      } else {
        await tx.eventTicketTier.create({
          data: {
            eventId: created.id,
            name: "General Admission",
            price: data.price || 0,
            quantity: data.maxAttendees || 200,
            availableQuantity: data.maxAttendees || 200,
            maxPerUser: 5,
          },
        });
      }

      // Auto-RSVP the creator as accepted
      await tx.eventParticipant.create({
        data: {
          eventId: created.id,
          userId,
          status: "ACCEPTED",
        },
      });

      return created;
    });

    ApiResponse.created(res, eventRecord, "Event hosted successfully");
  })
);

// ── 5. Book Event Tickets & Issue Passes (UPI / Cash / Free) ──
router.post(
  "/:id/book",
  validateParams(idParamSchema),
  validateBody(bookTicketSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = req.session!.user.id;
    const { tierId, quantity, paymentMethod, upiTransactionRef } = req.body;

    const event = await prisma.event.findUnique({
      where: { id },
      include: {
        ticketTiers: true,
        creator: { select: { id: true, name: true, email: true } },
      },
    });

    if (!event) return ApiResponse.notFound(res, "Event not found");
    if (event.status === "CANCELLED") {
      return ApiResponse.error(res, "Cannot book tickets for a cancelled event", 400, ErrorCode.INVALID_INPUT);
    }

    // Determine tier & unit price
    let selectedTier = tierId ? event.ticketTiers.find((t) => t.id === tierId) : event.ticketTiers[0];
    const unitPrice = selectedTier ? selectedTier.price : (event.price || 0);

    if (selectedTier && selectedTier.availableQuantity < quantity) {
      return ApiResponse.error(
        res,
        `Only ${selectedTier.availableQuantity} tickets remaining in ${selectedTier.name}`,
        400,
        ErrorCode.INVALID_INPUT
      );
    }

    // Calculate Platform Commission (3.5% default on paid tickets)
    const totalAmount = unitPrice * quantity;
    const isPaid = totalAmount > 0;
    const commissionRate = isPaid ? 0.035 : 0; // 3.5% commission
    const platformFee = isPaid ? Math.round(totalAmount * commissionRate * 100) / 100 : 0;
    const organiserEarnings = totalAmount - platformFee;

    const orderNumber = generateOrderNumber();
    const actualPaymentMethod = isPaid ? paymentMethod : "FREE";
    const paymentStatus = actualPaymentMethod === "CASH" ? "PENDING_CASH" : "COMPLETED";

    // Generate ticket tokens
    const ticketsData = Array.from({ length: quantity }).map(() => ({
      ticketCode: generateTicketCode(),
      tierName: selectedTier?.name || "General Pass",
    }));

    const result = await prisma.$transaction(async (tx) => {
      // 1. Create EventOrder
      const order = await tx.eventOrder.create({
        data: {
          orderNumber,
          eventId: event.id,
          userId,
          totalAmount,
          commissionRate,
          platformFee,
          organiserEarnings,
          paymentMethod: actualPaymentMethod as any,
          paymentStatus: paymentStatus as any,
          upiTransactionRef: upiTransactionRef || undefined,
        },
      });

      // 2. Create EventTickets
      const createdTickets = await Promise.all(
        ticketsData.map((t) =>
          tx.eventTicket.create({
            data: {
              ticketCode: t.ticketCode,
              orderId: order.id,
              eventId: event.id,
              userId,
              tierId: selectedTier?.id || undefined,
              status: "BOOKED",
            },
          })
        )
      );

      // 3. Decrement Tier inventory if exists
      if (selectedTier) {
        await tx.eventTicketTier.update({
          where: { id: selectedTier.id },
          data: { availableQuantity: { decrement: quantity } },
        });
      }

      // 4. Ensure user is in event_participants
      await tx.eventParticipant.upsert({
        where: { eventId_userId: { eventId: event.id, userId } },
        create: { eventId: event.id, userId, status: "ACCEPTED" },
        update: { status: "ACCEPTED" },
      });

      return { order, tickets: createdTickets };
    });

    // 5. Send Brevo confirmation email with entry pass & QR codes asynchronously
    const userProfile = await prisma.user.findUnique({ where: { id: userId } });
    if (userProfile?.email) {
      const startDate = new Date(event.scheduledAt);
      const eventDateStr = startDate.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      const eventTimeStr = startDate.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      });

      const emailPayload = buildEventBookingConfirmationTemplate({
        name: userProfile.name || userProfile.username,
        eventTitle: event.title,
        eventDate: eventDateStr,
        eventTime: eventTimeStr,
        venueName: event.location,
        orderNumber: result.order.orderNumber,
        totalAmount: result.order.totalAmount,
        paymentMethod: result.order.paymentMethod,
        tickets: ticketsData,
      });

      sendEmail({
        to: userProfile.email,
        toName: userProfile.name || undefined,
        subject: emailPayload.subject,
        html: emailPayload.html,
        text: emailPayload.text,
        tags: emailPayload.tags,
      }).catch((err) => console.error("[Events] Failed to send ticket email:", err));
    }

    ApiResponse.created(
      res,
      {
        order: result.order,
        tickets: result.tickets,
      },
      "Tickets booked successfully! An email pass with QR codes has been sent."
    );
  })
);

// ── 6. Validate & Scan Ticket at Gate Entrance ──
router.post(
  "/:id/validate-ticket",
  validateParams(idParamSchema),
  validateBody(validateTicketSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const scannerUserId = req.session!.user.id;
    const { ticketCode } = req.body;

    const event = await prisma.event.findUnique({
      where: { id },
      include: { club: true },
    });

    if (!event) return ApiResponse.notFound(res, "Event not found");

    // Check if scanner user is event creator, club owner, or officer
    const isStaffOrHost =
      event.creatorId === scannerUserId ||
      event.club?.ownerId === scannerUserId ||
      isStaff(req.session?.user?.roles);

    if (!isStaffOrHost) {
      const isClubOfficer = event.clubId
        ? await prisma.clubMember.findFirst({
            where: { clubId: event.clubId, userId: scannerUserId, role: "OFFICER" },
          })
        : false;

      if (!isClubOfficer) {
        return ApiResponse.forbidden(res, "Only event hosts or gate staff can validate tickets");
      }
    }

    // Look up ticket
    const ticket = await prisma.eventTicket.findFirst({
      where: {
        ticketCode: ticketCode.trim(),
        eventId: id,
      },
      include: {
        user: { select: { id: true, name: true, username: true, avatar: true, phone: true } },
        tier: { select: { id: true, name: true, price: true } },
        order: { select: { id: true, orderNumber: true, paymentMethod: true, paymentStatus: true } },
      },
    });

    if (!ticket) {
      return ApiResponse.error(res, "Invalid ticket pass for this event", 404, ErrorCode.NOT_FOUND);
    }

    if (ticket.status === "USED") {
      return ApiResponse.success(
        res,
        {
          valid: false,
          alreadyUsed: true,
          scannedAt: ticket.scannedAt,
          ticket,
          attendee: ticket.user,
        },
        "Ticket has already been used and checked in!"
      );
    }

    if (ticket.status === "CANCELLED") {
      return ApiResponse.error(res, "This ticket was cancelled or refunded", 400, ErrorCode.INVALID_INPUT);
    }

    // Mark ticket as USED
    const updatedTicket = await prisma.eventTicket.update({
      where: { id: ticket.id },
      data: {
        status: "USED",
        scannedAt: new Date(),
        scannedById: scannerUserId,
      },
      include: {
        user: { select: { id: true, name: true, username: true, avatar: true, phone: true } },
        tier: { select: { id: true, name: true, price: true } },
        order: { select: { id: true, orderNumber: true, paymentMethod: true, paymentStatus: true } },
      },
    });

    ApiResponse.success(
      res,
      {
        valid: true,
        alreadyUsed: false,
        ticket: updatedTicket,
        attendee: updatedTicket.user,
      },
      "Check-in verified! Valid entry."
    );
  })
);

// ── 7. Organiser Sales & Check-in Analytics ──
router.get(
  "/:id/metrics",
  validateParams(idParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = req.session!.user.id;

    const event = await prisma.event.findUnique({
      where: { id },
      include: {
        club: true,
        ticketTiers: true,
      },
    });

    if (!event) return ApiResponse.notFound(res, "Event not found");

    if (
      event.creatorId !== userId &&
      event.club?.ownerId !== userId &&
      !isStaff(req.session?.user?.roles)
    ) {
      return ApiResponse.forbidden(res, "You do not have permission to view event metrics");
    }

    const [orders, tickets, checkedInCount] = await Promise.all([
      prisma.eventOrder.findMany({
        where: { eventId: id },
        include: {
          user: { select: { id: true, name: true, avatar: true, username: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.eventTicket.findMany({
        where: { eventId: id },
        include: {
          user: { select: { id: true, name: true, avatar: true, username: true } },
          tier: { select: { id: true, name: true, price: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.eventTicket.count({
        where: { eventId: id, status: "USED" },
      }),
    ]);

    const totalGrossRevenue = orders.reduce((sum, o) => sum + o.totalAmount, 0);
    const totalPlatformFee = orders.reduce((sum, o) => sum + o.platformFee, 0);
    const netOrganiserEarnings = orders.reduce((sum, o) => sum + o.organiserEarnings, 0);

    const metrics = {
      totalTicketsSold: tickets.length,
      totalOrders: orders.length,
      checkedInCount,
      grossRevenue: totalGrossRevenue,
      platformFee: totalPlatformFee,
      commissionRatePercent: "3.5%",
      netOrganiserEarnings,
      tiers: event.ticketTiers,
      recentTickets: tickets.slice(0, 30),
      recentOrders: orders.slice(0, 30),
    };

    ApiResponse.success(res, metrics, "Event metrics retrieved successfully");
  })
);

// ── 8. Update Event ──
router.put(
  "/:id",
  validateParams(idParamSchema),
  validateBody(updateEventSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = req.session!.user.id;
    const data = req.body;

    const event = await prisma.event.findUnique({
      where: { id },
      include: { club: true },
    });

    if (!event) return ApiResponse.notFound(res, "Event not found");

    const isClubOfficer = event.clubId
      ? await prisma.clubMember.findFirst({
          where: { clubId: event.clubId, userId, role: "OFFICER" },
        })
      : false;

    if (
      event.creatorId !== userId &&
      event.club?.ownerId !== userId &&
      !isClubOfficer &&
      !isStaff(req.session?.user?.roles)
    ) {
      return ApiResponse.forbidden(res, "You do not have permission to edit this event");
    }

    const updated = await prisma.event.update({
      where: { id },
      data: {
        title: data.title,
        description: data.description,
        location: data.location,
        latitude: data.latitude,
        longitude: data.longitude,
        scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : undefined,
        endedAt: data.endedAt ? new Date(data.endedAt) : undefined,
        bannerImage: data.bannerImage,
        ticketUrl: data.ticketUrl,
        visibility: data.visibility,
        category: data.category,
        price: data.price,
        maxAttendees: data.maxAttendees,
      },
    });

    ApiResponse.success(res, updated, "Event updated successfully");
  })
);

// ── 9. Cancel / Delete Event ──
router.delete(
  "/:id",
  validateParams(idParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = req.session!.user.id;

    const event = await prisma.event.findUnique({
      where: { id },
      include: { club: true },
    });

    if (!event) return ApiResponse.notFound(res, "Event not found");

    if (
      event.creatorId !== userId &&
      event.club?.ownerId !== userId &&
      !isStaff(req.session?.user?.roles)
    ) {
      return ApiResponse.forbidden(res, "You do not have permission to delete this event");
    }

    await prisma.event.update({
      where: { id },
      data: { status: "CANCELLED" },
    });

    ApiResponse.success(res, null, "Event cancelled successfully");
  })
);

// ── 10. RSVP / Attend an Event ──
router.post(
  "/:id/attend",
  validateParams(idParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = req.session!.user.id;

    const eventRecord = await prisma.event.findUnique({
      where: { id },
      include: {
        _count: { select: { participants: true } },
      },
    });

    if (!eventRecord) return ApiResponse.notFound(res, "Event not found");
    if (eventRecord.status === "CANCELLED") {
      return ApiResponse.error(res, "Cannot join a cancelled event", 400, ErrorCode.INVALID_INPUT);
    }

    if (
      eventRecord.maxAttendees &&
      eventRecord._count.participants >= eventRecord.maxAttendees
    ) {
      return ApiResponse.error(res, "This event has reached full capacity", 400, ErrorCode.INVALID_INPUT);
    }

    const participation = await prisma.eventParticipant.upsert({
      where: { eventId_userId: { eventId: id, userId } },
      create: { eventId: id, userId, status: "ACCEPTED" },
      update: { status: "ACCEPTED" },
    });

    ApiResponse.success(res, participation, "Joined event successfully");
  })
);

// ── 11. Leave / Cancel RSVP for an Event ──
router.post(
  "/:id/leave",
  validateParams(idParamSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const userId = req.session!.user.id;

    await prisma.eventParticipant.deleteMany({
      where: { eventId: id, userId },
    });

    ApiResponse.success(res, null, "Left event successfully");
  })
);

export default router;
