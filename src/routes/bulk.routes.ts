import { Router, Request, Response } from "express";
import { BulkActionSchema, processBulkAction } from "../lib/bulkActions.js";
import { ApiResponse } from "../lib/utils/apiResponse.js";
import { asyncHandler, validateBody } from "../middlewares/validation.js";
import { requireAuth } from "../config/auth.js";
import { UserRole, requireRole, requireWebAccess } from "../middlewares/rbac.js";

const router = Router();

// All bulk routes require authentication and web access
router.use(requireAuth);
router.use(requireWebAccess);

/**
 * @swagger
 * /api/bulk/action:
 *   post:
 *     summary: Perform bulk actions (admin)
 *     description: Perform bulk actions on multiple items in a single request. Supports approval, rejection, verification, etc.
 *     tags: [Bulk Actions]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - module
 *               - action
 *               - ids
 *             properties:
 *               module:
 *                 type: string
 *                 enum: [clubs, club-join-requests, ride-participants, businesses, ad-campaigns]
 *               action:
 *                 type: string
 *                 enum: [approve, reject, verify, accept, decline]
 *               ids:
 *                 type: array
 *                 items:
 *                   type: string
 *                 minItems: 1
 *                 maxItems: 500
 *               data:
 *                 type: object
 *                 description: Additional data like rejection notes
 *     responses:
 *       200:
 *         description: Bulk action completed
 *       400:
 *         description: Invalid request
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Insufficient permissions
 */
router.post(
  "/action",
  requireRole(UserRole.ADMIN, UserRole.CO_ADMIN),
  validateBody(BulkActionSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const result = await processBulkAction(req.body, {
      userId: session?.user?.id,
      userRoles: session?.userRoles,
    });
    
    ApiResponse.success(res, result, `Bulk action completed: ${result.processed} items processed`);
  }),
);

/**
 * @swagger
 * /api/club-manager/bulk/action:
 *   post:
 *     summary: Perform bulk actions (club manager)
 *     description: Perform bulk actions on club-related items for clubs the user owns/manages.
 *     tags: [Bulk Actions]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - module
 *               - action
 *               - ids
 *             properties:
 *               module:
 *                 type: string
 *                 enum: [club-member-requests]
 *               action:
 *                 type: string
 *                 enum: [approve, reject]
 *               ids:
 *                 type: array
 *                 items:
 *                   type: string
 *                 minItems: 1
 *                 maxItems: 500
 *               data:
 *                 type: object
 *                 description: Additional data like rejection notes
 *     responses:
 *       200:
 *         description: Bulk action completed
 *       400:
 *         description: Invalid request
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Insufficient permissions (not a club manager)
 */
router.post(
  "/club-manager/action",
  requireAuth,
  requireWebAccess,
  validateBody(BulkActionSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { module, action } = req.body;
    
    // Club managers can only perform certain actions
    const allowedModules = ["club-member-requests"];
    const allowedActions = ["approve", "reject"];
    
    if (!allowedModules.includes(module)) {
      return ApiResponse.forbidden(
        res,
        `Club managers can only perform actions on: ${allowedModules.join(", ")}`,
        "INSUFFICIENT_PERMISSIONS"
      );
    }
    
    if (!allowedActions.includes(action)) {
      return ApiResponse.forbidden(
        res,
        `Club managers can only perform: ${allowedActions.join(", ")} actions`,
        "INSUFFICIENT_PERMISSIONS"
      );
    }
    
    const result = await processBulkAction(req.body, {
      userId: session?.user?.id,
      userRoles: session?.userRoles,
    });
    
    ApiResponse.success(res, result, `Bulk action completed: ${result.processed} items processed`);
  }),
);

/**
 * @swagger
 * /api/brand-manager/bulk/action:
 *   post:
 *     summary: Perform bulk actions (brand manager)
 *     description: Perform bulk actions on brand-related items for brands the user owns.
 *     tags: [Bulk Actions]
 *     security:
 *       - cookieAuth: []
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - module
 *               - action
 *               - ids
 *             properties:
 *               module:
 *                 type: string
 *                 enum: [brand-campaigns]
 *               action:
 *                 type: string
 *                 enum: [approve, reject]
 *               ids:
 *                 type: array
 *                 items:
 *                   type: string
 *                 minItems: 1
 *                 maxItems: 500
 *               data:
 *                 type: object
 *                 description: Additional data like rejection notes
 *     responses:
 *       200:
 *         description: Bulk action completed
 *       400:
 *         description: Invalid request
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Insufficient permissions (not a brand owner)
 */
router.post(
  "/brand-manager/action",
  requireAuth,
  requireWebAccess,
  validateBody(BulkActionSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const session = (req as any).session;
    const { module, action } = req.body;

    // Brand managers can manage their campaigns + their own product catalogue.
    const allowedModules = ["brand-campaigns", "brand-products"];
    const allowedActions = ["approve", "reject", "delete", "feature", "unfeature", "hide", "show"];
    
    if (!allowedModules.includes(module)) {
      return ApiResponse.forbidden(
        res,
        `Brand managers can only perform actions on: ${allowedModules.join(", ")}`,
        "INSUFFICIENT_PERMISSIONS"
      );
    }
    
    if (!allowedActions.includes(action)) {
      return ApiResponse.forbidden(
        res,
        `Brand managers can only perform: ${allowedActions.join(", ")} actions`,
        "INSUFFICIENT_PERMISSIONS"
      );
    }
    
    const result = await processBulkAction(req.body, {
      userId: session?.user?.id,
      userRoles: session?.userRoles,
    });
    
    ApiResponse.success(res, result, `Bulk action completed: ${result.processed} items processed`);
  }),
);

export default router;