import { pgTable, text, integer, timestamp, serial } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(), // Firebase Auth UID
  email: text('email'),
  displayName: text('display_name'),
  photoURL: text('photo_url'),
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

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const videoProjects = pgTable('video_projects', {
  id: text('id').primaryKey(),
  uid: text('uid').notNull(),
  title: text('title').notNull(),
  videoFilename: text('video_filename').notNull(),
  videoUrl: text('video_url').notNull(),
  durationSec: integer('duration_sec').notNull().default(0),
  status: text('status').notNull().default('uploaded'),
  mode: text('mode').notNull().default('understand'),
  analysisData: text('analysis_data'),
  scriptData: text('script_data'),
  sfxData: text('sfx_data'),
  audioMixMode: text('audio_mix_mode').notNull().default('ducking'),
  finalVideoUrl: text('final_video_url'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
