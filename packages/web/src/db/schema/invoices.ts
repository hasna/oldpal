import { pgTable, uuid, varchar, integer, text, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';

export const invoiceStatusEnum = pgEnum('invoice_status', [
  'draft',
  'open',
  'paid',
  'void',
  'uncollectible',
]);

export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  stripeInvoiceId: varchar('stripe_invoice_id', { length: 255 }).unique(),
  amountDue: integer('amount_due').notNull(), // cents
  amountPaid: integer('amount_paid').default(0),
  status: invoiceStatusEnum('status').default('draft').notNull(),
  invoiceUrl: text('invoice_url'),
  pdfUrl: text('pdf_url'),
  periodStart: timestamp('period_start'),
  periodEnd: timestamp('period_end'),
  paidAt: timestamp('paid_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const invoicesRelations = relations(invoices, ({ one }) => ({
  user: one(users, {
    fields: [invoices.userId],
    references: [users.id],
  }),
}));

export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
