-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "EventPaymentMethod" AS ENUM ('UPI', 'CASH', 'FREE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "EventPaymentStatus" AS ENUM ('COMPLETED', 'PENDING_CASH', 'FAILED', 'REFUNDED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "EventTicketStatus" AS ENUM ('BOOKED', 'USED', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "ExpenseCategory" AS ENUM ('FUEL', 'SERVICING', 'FOOD', 'ACCOMMODATION', 'OTHER');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "ExpenseSplitStatus" AS ENUM ('PENDING', 'SETTLED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'EXPENSE_SPLIT_REQUEST';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'EXPENSE_SETTLED';

-- AlterTable
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "category" TEXT DEFAULT 'MEETUP',
ADD COLUMN IF NOT EXISTS "max_attendees" INTEGER,
ADD COLUMN IF NOT EXISTS "price" DOUBLE PRECISION DEFAULT 0,
ADD COLUMN IF NOT EXISTS "visibility" TEXT NOT NULL DEFAULT 'PUBLIC';

-- CreateTable event_ticket_tiers
CREATE TABLE IF NOT EXISTS "event_ticket_tiers" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "quantity" INTEGER NOT NULL DEFAULT 100,
    "available_quantity" INTEGER NOT NULL DEFAULT 100,
    "max_per_user" INTEGER NOT NULL DEFAULT 5,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_ticket_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable event_orders
CREATE TABLE IF NOT EXISTS "event_orders" (
    "id" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "total_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "commission_rate" DOUBLE PRECISION NOT NULL DEFAULT 0.035,
    "platform_fee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "organiser_earnings" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "payment_method" "EventPaymentMethod" NOT NULL DEFAULT 'FREE',
    "payment_status" "EventPaymentStatus" NOT NULL DEFAULT 'COMPLETED',
    "upi_transaction_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable event_tickets
CREATE TABLE IF NOT EXISTS "event_tickets" (
    "id" TEXT NOT NULL,
    "ticket_code" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tier_id" TEXT,
    "status" "EventTicketStatus" NOT NULL DEFAULT 'BOOKED',
    "scanned_at" TIMESTAMP(3),
    "scanned_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable expenses
CREATE TABLE IF NOT EXISTS "expenses" (
    "id" TEXT NOT NULL,
    "creator_id" TEXT NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "category" "ExpenseCategory" NOT NULL DEFAULT 'OTHER',
    "description" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ride_id" TEXT,
    "club_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable expense_splits
CREATE TABLE IF NOT EXISTS "expense_splits" (
    "id" TEXT NOT NULL,
    "expense_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "status" "ExpenseSplitStatus" NOT NULL DEFAULT 'PENDING',
    "settled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_splits_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_ticket_tier_event" ON "event_ticket_tiers"("event_id");
CREATE UNIQUE INDEX IF NOT EXISTS "event_orders_order_number_key" ON "event_orders"("order_number");
CREATE INDEX IF NOT EXISTS "idx_event_order_event_user" ON "event_orders"("event_id", "user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "event_tickets_ticket_code_key" ON "event_tickets"("ticket_code");
CREATE INDEX IF NOT EXISTS "idx_event_ticket_event_code" ON "event_tickets"("event_id", "ticket_code");
CREATE INDEX IF NOT EXISTS "idx_event_ticket_user" ON "event_tickets"("user_id");
CREATE INDEX IF NOT EXISTS "idx_expense_creator_date" ON "expenses"("creator_id", "date");
CREATE INDEX IF NOT EXISTS "idx_expense_split_user_status" ON "expense_splits"("user_id", "status");

-- Foreign Keys
DO $$ BEGIN
  ALTER TABLE "event_ticket_tiers" ADD CONSTRAINT "event_ticket_tiers_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "event_orders" ADD CONSTRAINT "event_orders_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "event_orders" ADD CONSTRAINT "event_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "event_tickets" ADD CONSTRAINT "event_tickets_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "event_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "event_tickets" ADD CONSTRAINT "event_tickets_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "event_tickets" ADD CONSTRAINT "event_tickets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "event_tickets" ADD CONSTRAINT "event_tickets_tier_id_fkey" FOREIGN KEY ("tier_id") REFERENCES "event_ticket_tiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "expenses" ADD CONSTRAINT "expenses_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "expense_splits" ADD CONSTRAINT "expense_splits_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "expense_splits" ADD CONSTRAINT "expense_splits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
