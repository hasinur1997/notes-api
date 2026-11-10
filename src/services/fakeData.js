/**
 * Realistic test data for `npm run seed -- --fake`. Pure functions with a seeded random
 * generator, so the same seed always produces the same notes (easy to test and reproduce).
 */
import { NOTE_COLORS } from '../models/Note.js';

/** Marks documents created by the fake seed, so `--clear-fake` removes exactly them. */
export const FAKE_SEED_FIELD = 'fakeSeed';

const DAY_MS = 86_400_000;

/**
 * Small deterministic random generator (mulberry32).
 *
 * @param {number} seed - Any integer.
 * @returns {() => number} Function returning floats in [0, 1).
 */
export function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Picks one item. */
const pick = (random, items) => items[Math.floor(random() * items.length)];

/** Picks `count` distinct items. */
function pickMany(random, items, count) {
  const pool = [...items];
  const chosen = [];
  while (chosen.length < count && pool.length) chosen.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  return chosen;
}

/** 40 labels, enough to make the sidebar list overflow. */
export const FAKE_LABELS = [
  'Work', 'Personal', 'Ideas', 'Reading', 'Interview prep', 'JavaScript', 'TypeScript', 'NodeJS', 'React', 'Next.js',
  'MongoDB', 'Python', 'Laravel', 'DevOps', 'Design', 'Travel', 'Recipes', 'Fitness', 'Finance', 'Shopping',
  'Family', 'Health', 'Books', 'Movies', 'Music', 'Learning', 'Meetings', 'Projects', 'Side hustle', 'Home',
  'Garden', 'Car', 'Taxes', 'Gifts', 'Birthdays', 'Quotes', 'Journal', 'Goals', 'Habits', 'Someday',
];

const TOPICS = [
  ['Sprint planning', ['Groom the backlog', 'Estimate the auth stories', 'Agree on the release date', 'Assign reviewers']],
  ['Grocery list', ['Rice', 'Lentils', 'Mustard oil', 'Eggs', 'Green chillies', 'Tea', 'Onions']],
  ['Index strategy', ['users: email (unique), interests', 'notes: owner + _id', 'notes: collaborators + _id', 'Nothing else']],
  ['Book notes', ['Designing Data-Intensive Applications', 'The Pragmatic Programmer', 'Clean Architecture', 'Deep Work']],
  ['Trip to Cox’s Bazar', ['Book the bus tickets', 'Reserve a hotel near the beach', 'Pack sunscreen', 'Charge the camera']],
  ['Weekly review', ['What went well', 'What to improve', 'Top three goals for next week']],
  ['Recipe: chicken curry', ['Marinate the chicken', 'Fry onions until golden', 'Add spices and tomatoes', 'Simmer for 30 minutes']],
  ['Workout plan', ['Monday: push', 'Wednesday: pull', 'Friday: legs', 'Daily: 20 minute walk']],
  ['Interview questions', ['Explain the event loop', 'How does $facet work?', 'Design a rate limiter', 'Trade-offs of indexes']],
  ['Side project ideas', ['Shared expense tracker', 'Habit streak app', 'Recipe scaler', 'Reading list with reminders']],
  ['Meeting notes', ['Decisions', 'Action items', 'Open questions', 'Next meeting on Thursday']],
  ['Budget', ['Rent', 'Utilities', 'Groceries', 'Savings', 'Fun money']],
  ['Learning plan', ['Finish the MongoDB course', 'Build one small project', 'Write a blog post about it']],
  ['Gift ideas', ['Headphones', 'A good notebook', 'Cooking class', 'Plant for the balcony']],
  ['Release checklist', ['Run the tests', 'Run npm run explain', 'Tag the release', 'Deploy to Render and Vercel']],
];

const SENTENCES = [
  'Ship simple and explain every decision clearly.',
  'Remember to back up the laptop before the update.',
  'Call the bank about the card on Monday morning.',
  'The ESR rule: equality fields first, then sort, then range.',
  'Keep the scope small and finish what you start.',
  'Share live URLs and demo accounts before the call.',
  'Water the plants and clean the desk this weekend.',
  'Pagination belongs inside the pipeline with $facet.',
];

/**
 * Builds one note's Markdown text in one of several styles (list, numbered, heading, prose).
 *
 * @param {() => number} random - Seeded random generator.
 * @param {string[]} items - Topic items.
 * @returns {string} Markdown content.
 */
function buildContent(random, items) {
  const style = Math.floor(random() * 5);
  const chosen = pickMany(random, items, 2 + Math.floor(random() * (items.length - 1)));
  if (style === 0) return chosen.map((item) => `- ${item}`).join('\n');
  if (style === 1) return chosen.map((item, i) => `${i + 1}. ${item}`).join('\n');
  if (style === 2) return `## Plan\n${chosen.map((item) => `- ${item}`).join('\n')}\n\n**Note:** ${pick(random, SENTENCES)}`;
  if (style === 3) return `${pick(random, SENTENCES)} _${pick(random, SENTENCES)}_`;
  return '';
}

/**
 * Builds fake note documents (plain objects, ready to be validated by the Note model).
 *
 * @param {object} options
 * @param {import('mongoose').Types.ObjectId} options.ownerId - Owner of the notes.
 * @param {number} options.count - How many notes.
 * @param {number} [options.seed=42] - Random seed.
 * @param {Date} [options.now=new Date()] - Reference time for dates and reminders.
 * @param {import('mongoose').Types.ObjectId[]} [options.collaboratorIds=[]] - People some notes are shared with.
 * @param {number} [options.shareEvery=0] - Share every n-th note with the collaborators (0 = never).
 * @returns {object[]} Note fields: title, content, labels, pinned, color, reminderAt, collaborators, timestamps.
 */
export function buildFakeNotes({ ownerId, count, seed = 42, now = new Date(), collaboratorIds = [], shareEvery = 0 }) {
  const random = createRandom(seed);
  const notes = [];
  for (let i = 0; i < count; i++) {
    const [topic, items] = pick(random, TOPICS);
    const updatedAt = new Date(now.getTime() - Math.floor(random() * 60 * DAY_MS));
    const hasReminder = random() < 0.12;
    notes.push({
      owner: ownerId,
      title: `${topic} #${i + 1}`,
      content: buildContent(random, items),
      // 0-3 labels, cycling so that every label is used at least once.
      labels: [FAKE_LABELS[i % FAKE_LABELS.length], ...pickMany(random, FAKE_LABELS, Math.floor(random() * 3))],
      pinned: random() < 0.08,
      color: random() < 0.35 ? pick(random, NOTE_COLORS) : 'default',
      // Mostly upcoming reminders, a few already overdue.
      reminderAt: hasReminder ? new Date(now.getTime() + (random() < 0.25 ? -1 : 1) * Math.ceil(random() * 10) * DAY_MS) : null,
      collaborators: shareEvery && (i + 1) % shareEvery === 0 ? collaboratorIds : [],
      createdAt: updatedAt,
      updatedAt,
    });
  }
  return notes;
}
