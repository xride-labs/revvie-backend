import { Router } from "express";
import prisma from "../../lib/prisma.js";
import { requireAuth } from "../../config/auth.js";
import { ApiResponse, ErrorCode } from "../../lib/utils/apiResponse.js";
import { asyncHandler, validateBody, validateQuery } from "../../middlewares/validation.js";
import { z } from "zod";
import { ExpenseCategory } from "@prisma/client";

const router = Router();

// ========================================
// Schemas
// ========================================

const createExpenseSchema = z.object({
  amountPaise: z.number().int().positive(),
  category: z.nativeEnum(ExpenseCategory).default(ExpenseCategory.OTHER),
  description: z.string().optional(),
  date: z.string().datetime().optional(),
  rideId: z.string().optional(),
  clubId: z.string().optional(),
  splits: z
    .array(
      z.object({
        userId: z.string(),
        amountPaise: z.number().int().positive(),
      })
    )
    .optional(),
});

const getExpensesQuerySchema = z.object({
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).optional(),
  category: z.nativeEnum(ExpenseCategory).optional(),
});

// ========================================
// Routes
// ========================================

/**
 * @route   POST /api/expenses
 * @desc    Create a new expense, optionally with splits
 * @access  Private
 */
router.post(
  "/",
  requireAuth,
  validateBody(createExpenseSchema),
  asyncHandler(async (req, res) => {
    const userId = req.session!.user.id;
    const { amountPaise, category, description, date, rideId, clubId, splits } = req.body;

    const expense = await prisma.$transaction(async (tx) => {
      // 1. Create the expense
      const newExpense = await tx.expense.create({
        data: {
          creatorId: userId,
          amountPaise,
          category,
          description,
          date: date ? new Date(date) : new Date(),
          rideId,
          clubId,
        },
      });

      // 2. Create splits if provided
      if (splits && splits.length > 0) {
        await tx.expenseSplit.createMany({
          data: splits.map((split: any) => ({
            expenseId: newExpense.id,
            userId: split.userId,
            amountPaise: split.amountPaise,
            status: "PENDING",
          })),
        });

        // 3. Create notifications for the split users
        const splitUsers = splits.map((s: any) => s.userId).filter((id: string) => id !== userId);
        if (splitUsers.length > 0) {
          const userObj = await tx.user.findUnique({ where: { id: userId } });
          const userName = userObj?.name || userObj?.username || "A rider";

          await tx.notification.createMany({
            data: splitUsers.map((id: string) => ({
              userId: id,
              type: "EXPENSE_SPLIT_REQUEST",
              title: "Expense Split Request",
              message: `${userName} requested to split an expense for ${description || category}.`,
              relatedType: "expense",
              relatedId: newExpense.id,
            })),
          });
        }
      }

      return newExpense;
    });

    return ApiResponse.created(res, expense, "Expense created successfully");
  })
);

/**
 * @route   GET /api/expenses
 * @desc    Get current user's expenses (created by them)
 * @access  Private
 */
router.get(
  "/",
  requireAuth,
  validateQuery(getExpensesQuerySchema),
  asyncHandler(async (req, res) => {
    const userId = req.session!.user.id;
    const { month, year, category } = req.query as any;

    let dateFilter = {};
    if (month && year) {
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0, 23, 59, 59, 999);
      dateFilter = {
        date: {
          gte: startDate,
          lte: endDate,
        },
      };
    } else if (month) {
        const currYear = new Date().getFullYear();
        const startDate = new Date(currYear, month - 1, 1);
        const endDate = new Date(currYear, month, 0, 23, 59, 59, 999);
        dateFilter = {
          date: {
            gte: startDate,
            lte: endDate,
          },
        };
    }

    const where = {
      creatorId: userId,
      ...dateFilter,
      ...(category ? { category } : {}),
    };

    const expenses = await prisma.expense.findMany({
      where,
      orderBy: { date: "desc" },
      include: {
        splits: {
          include: {
            user: { select: { id: true, name: true, avatar: true } },
          },
        },
      },
    });

    return ApiResponse.success(res, expenses);
  })
);

/**
 * @route   GET /api/expenses/splits
 * @desc    Get splits requested from the current user (owed by them)
 * @access  Private
 */
router.get(
  "/splits",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.session!.user.id;
    
    // Splits where I owe someone
    const owedByMe = await prisma.expenseSplit.findMany({
      where: { userId },
      include: {
        expense: {
          include: {
            creator: { select: { id: true, name: true, avatar: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Splits where someone owes me
    const owedToMe = await prisma.expenseSplit.findMany({
      where: { expense: { creatorId: userId } },
      include: {
        user: { select: { id: true, name: true, avatar: true } },
        expense: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return ApiResponse.success(res, { owedByMe, owedToMe });
  })
);

/**
 * @route   PATCH /api/expenses/splits/:id/settle
 * @desc    Mark a split as settled
 * @access  Private
 */
router.patch(
  "/splits/:id/settle",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.session!.user.id;
    const { id } = req.params;

    const split = await prisma.expenseSplit.findUnique({
      where: { id },
      include: { expense: true },
    });

    if (!split) {
      return ApiResponse.notFound(res, "Split not found");
    }

    // Only the creator of the expense or the person who owes can settle it
    if (split.expense.creatorId !== userId && split.userId !== userId) {
      return ApiResponse.forbidden(res, "Not authorized to settle this split");
    }

    const updatedSplit = await prisma.expenseSplit.update({
      where: { id },
      data: {
        status: "SETTLED",
        settledAt: new Date(),
      },
    });

    // Notify the other party
    const notifyUserId = userId === split.expense.creatorId ? split.userId : split.expense.creatorId;
    const userObj = await prisma.user.findUnique({ where: { id: userId } });
    const userName = userObj?.name || userObj?.username || "A rider";

    await prisma.notification.create({
      data: {
        userId: notifyUserId,
        type: "EXPENSE_SETTLED",
        title: "Expense Settled",
        message: `${userName} marked the expense split as settled.`,
        relatedType: "expense",
        relatedId: split.expense.id,
      }
    });

    return ApiResponse.success(res, updatedSplit, "Split settled successfully");
  })
);

export default router;
