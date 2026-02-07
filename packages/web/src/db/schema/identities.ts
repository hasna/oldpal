import { pgTable, uuid, varchar, text, boolean, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';

// Contact entry for emails/phones
export interface ContactEntry {
  value: string;
  label: string;
  isPrimary?: boolean;
}

// Address entry
export interface AddressEntry {
  street: string;
  city: string;
  state?: string;
  postalCode: string;
  country: string;
  label: string;
}

// Social media entry
export interface SocialEntry {
  platform: string;
  value: string;
  label?: string;
}

// Identity contacts
export interface IdentityContacts {
  emails: ContactEntry[];
  phones: ContactEntry[];
  addresses: AddressEntry[];
  virtualAddresses?: ContactEntry[];
  social?: SocialEntry[];
}

// Identity preferences
export interface IdentityPreferences {
  language: string;
  dateFormat: string;
  communicationStyle: 'formal' | 'casual' | 'professional';
  responseLength: 'concise' | 'detailed' | 'balanced';
  codeStyle?: {
    indentation: 'tabs' | 'spaces';
    indentSize: number;
    quoteStyle: 'single' | 'double';
  };
  custom: Record<string, unknown>;
}

export const identities = pgTable('identities', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  isDefault: boolean('is_default').default(false).notNull(),
  displayName: varchar('display_name', { length: 255 }),
  title: varchar('title', { length: 255 }),
  company: varchar('company', { length: 255 }),
  bio: text('bio'),
  timezone: varchar('timezone', { length: 50 }).default('UTC').notNull(),
  locale: varchar('locale', { length: 10 }).default('en-US').notNull(),
  contacts: jsonb('contacts').$type<IdentityContacts>(),
  preferences: jsonb('preferences').$type<IdentityPreferences>(),
  context: text('context'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const identitiesRelations = relations(identities, ({ one }) => ({
  user: one(users, {
    fields: [identities.userId],
    references: [users.id],
  }),
}));

export type Identity = typeof identities.$inferSelect;
export type NewIdentity = typeof identities.$inferInsert;
