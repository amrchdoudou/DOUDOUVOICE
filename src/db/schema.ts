import { pgTable, text, integer, timestamp, serial } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(), // Firebase Auth UID
  plan: text('plan').notNull().default('Free'),
  generationCount: integer('generation_count').notNull().default(0),
  limitCharacters: integer('limit_characters').notNull().default(5000),
  usedCharacters: integer('used_characters').notNull().default(0),
  updatedAt: timestamp('updated_at').defaultNow(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const pendingOrders = pgTable('pending_orders', {
  id: text('id').primaryKey(), // PayPal order ID
  uid: text('uid').notNull(),
  plan: text('plan').notNull(),
  price: text('price').notNull(),
  status: text('status').notNull().default('PENDING'),
  createdAt: timestamp('created_at').defaultNow(),
  completedAt: timestamp('completed_at'),
});

export const history = pgTable('history', {
  id: text('id').primaryKey(),
  uid: text('uid').notNull(),
  text: text('text').notNull(),
  language: text('language').notNull(),
  voice: text('voice').notNull(),
  audioUrl: text('audio_url').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});
