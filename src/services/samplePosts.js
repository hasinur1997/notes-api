/**
 * Sample public posts for `npm run seed -- --sample-posts`: a few sample authors (with interests,
 * so the interest groups have data too) and hand-written posts. Every document carries the
 * FAKE_SEED_FIELD marker, so `--clear-sample-posts` removes exactly them and nothing real.
 */
import { randomBytes } from 'node:crypto';
import { Post } from '../models/Post.js';
import { User } from '../models/User.js';
import { FAKE_SEED_FIELD } from './fakeData.js';

const HOUR_MS = 3_600_000;

/** Sample authors. Their passwords are random and never shown, so nobody can sign in as them. */
export const SAMPLE_AUTHORS = Object.freeze([
  { key: 'ayesha', name: 'Ayesha Rahman', email: 'ayesha.sample@example.com', interests: ['reading', 'travel', 'cooking'] },
  { key: 'tanvir', name: 'Tanvir Hasan', email: 'tanvir.sample@example.com', interests: ['programming', 'mongodb', 'chess'] },
  { key: 'nusrat', name: 'Nusrat Jahan', email: 'nusrat.sample@example.com', interests: ['photography', 'travel', 'reading'] },
  { key: 'rafiq', name: 'Rafiq Ahmed', email: 'rafiq.sample@example.com', interests: ['chess', 'fitness', 'programming'] },
]);

/** Sample posts, oldest first. `hoursAgo` spreads them over the last few weeks. */
export const SAMPLE_POSTS = Object.freeze([
  {
    author: 'tanvir',
    hoursAgo: 520,
    color: 'sky',
    title: 'Why I stopped sorting by createdAt',
    content: `Every list in my API used to sort by createdAt. That needs its own index, or MongoDB sorts in memory.

## The fix
- The _id field already grows over time, so sorting by it (descending) gives newest first.
- A compound index like { author: 1, _id: -1 } serves the filter **and** the sort.

One index fewer, and no in-memory **SORT** stage in explain().`,
  },
  {
    author: 'ayesha',
    hoursAgo: 470,
    color: 'amber',
    title: 'Three days in Sylhet',
    content: `Tea gardens, rain and the clearest water I have ever seen at **Ratargul**.

1. Day one: Jaflong and the stone collectors by the river
2. Day two: a boat through the swamp forest
3. Day three: tea tasting at Srimangal (try the seven-layer tea!)

Pack a raincoat. Seriously.`,
  },
  {
    author: 'rafiq',
    hoursAgo: 430,
    color: 'mint',
    title: 'My 20-minute morning routine',
    content: `No gym, no equipment:

- 5 minutes of stretching
- 3 rounds of 15 squats, 10 push-ups, 30 second plank
- 5 minutes of walking outside

The trick is not motivation, it is doing it **before** checking the phone.`,
  },
  {
    author: 'nusrat',
    hoursAgo: 400,
    color: 'lavender',
    title: 'Golden hour on the Padma',
    content: `I spent an evening on a small boat near Mawa, waiting for the light.

The best shots came in the *ten minutes after sunset*, not during it. The sky turns pink and the water goes perfectly still.

Settings I used: f/8, ISO 200, a light tripod on the boat edge.`,
  },
  {
    author: 'tanvir',
    hoursAgo: 360,
    title: '$lookup without populate',
    content: `Mongoose populate() runs a second query behind your back. For a user's profile with their posts, one aggregation is enough:

1. $match the user by _id
2. $project only public fields
3. $lookup into posts with a pipeline: sort, skip, limit
4. A second $lookup with $count for the total

One round trip, and each lookup uses the { author: 1, _id: -1 } index.`,
  },
  {
    author: 'ayesha',
    hoursAgo: 330,
    color: 'coral',
    title: 'Beef bhuna, the slow way',
    content: `My grandmother's rule: **never rush the onions**.

- Fry sliced onions on low heat until deep brown (25 minutes)
- Add garlic, ginger, cumin, coriander and chilli; cook until the oil separates
- Add the beef, then cover and let it cook in its own juices for an hour

Serve with plain rice and a squeeze of lime.`,
  },
  {
    author: 'rafiq',
    hoursAgo: 290,
    color: 'sand',
    title: 'The London System saved my rating',
    content: `I used to lose games in the first ten moves. Then I picked **one** opening and stuck with it.

The London is not flashy, but:
- the same setup works against almost everything
- the plans are easy to remember
- you reach a solid middle game every time

Up 150 points in two months.`,
  },
  {
    author: 'nusrat',
    hoursAgo: 250,
    title: 'Books I read this month',
    content: `- **Deep Work** by Cal Newport: changed how I plan my mornings
- **The Pragmatic Programmer**: still relevant after twenty years
- **Padma Nadir Majhi** by Manik Bandopadhyay: a re-read, still heartbreaking

Next up: *Designing Data-Intensive Applications*.`,
  },
  {
    author: 'tanvir',
    hoursAgo: 210,
    color: 'sky',
    title: 'Counting without scanning',
    content: `countDocuments({}) reads the whole collection. For an unfiltered total, estimatedDocumentCount() reads collection metadata instead.

Use it for:
- the total on an admin "all users" page
- a public feed's page count

Do **not** use it with a filter: it ignores filters completely.`,
  },
  {
    author: 'ayesha',
    hoursAgo: 170,
    color: 'mint',
    title: 'A reading corner for under 3000 taka',
    content: `A floor cushion, a clamp lamp with a warm bulb, and a small shelf made from two wooden crates.

The lamp makes the biggest difference: *warm light, aimed at the page*, not at your eyes.`,
  },
  {
    author: 'rafiq',
    hoursAgo: 140,
    title: 'Learning to code at 35',
    content: `Six months ago I wrote my first console.log. Things that helped:

1. Building small tools I actually needed (a chess score tracker)
2. Reading other people's code on GitHub
3. Writing notes after every session, even three lines

Things that did not help: watching tutorials without typing along.`,
  },
  {
    author: 'nusrat',
    hoursAgo: 100,
    color: 'rose',
    title: 'Street food walk in Old Dhaka',
    content: `Start at **Chawkbazar** in the late afternoon:

- shahi jilapi the size of a plate
- bakarkhani straight from the clay oven
- lassi at Beauty, of course

Go hungry, bring cash, and wear shoes you do not mind getting dusty.`,
  },
  {
    author: 'tanvir',
    hoursAgo: 60,
    color: 'lavender',
    title: 'One aggregate call, grouped and paginated',
    content: `To show users grouped by interest with pagination, you do not need a second query for the total.

$facet runs two sub-pipelines on the same input:
- meta: [{ $count: "total" }]
- data: [{ $skip }, { $limit }]

Filter first with $match on interests so the multikey index does the work.`,
  },
  {
    author: 'ayesha',
    hoursAgo: 30,
    color: 'amber',
    title: 'Packing light for a week',
    content: `Everything fit in a 30 litre backpack:

- 3 shirts, 2 trousers, 1 light jacket
- a sarong (towel, blanket and beach mat in one)
- a power bank and one universal charger

Rule of thumb: if you are not sure you need it, you don't.`,
  },
  {
    author: 'rafiq',
    hoursAgo: 6,
    color: 'sand',
    title: 'Weekend chess meetup',
    content: `We are meeting at the **Dhanmondi Lake** café on Saturday at 4 pm. All levels welcome; bring a board if you have one.

Blitz first, then a small rapid tournament. Tea is on me.`,
  },
]);

/** Finds or creates one sample author (marked), returning its id. */
async function ensureAuthor({ name, email, interests }) {
  const existing = await User.findOne({ email }, { _id: 1 }).lean();
  if (existing) return existing._id;
  const user = await User.create({ name, email, interests, password: randomBytes(24).toString('hex') });
  await User.collection.updateOne({ _id: user._id }, { $set: { [FAKE_SEED_FIELD]: true } });
  return user._id;
}

/**
 * Creates the sample authors and their posts. Posts are validated through the Post model and
 * inserted oldest first, so their _id order (the feed order) matches their dates.
 * Running it again first removes the previous sample posts, so it never duplicates them.
 *
 * @param {{ now?: Date }} [options] - Reference time for the post dates.
 * @returns {Promise<{ authors: number, posts: number }>} What exists afterwards.
 */
export async function seedSamplePosts({ now = new Date() } = {}) {
  const ids = {};
  for (const author of SAMPLE_AUTHORS) ids[author.key] = await ensureAuthor(author);
  await clearSamplePosts({ keepAuthors: true });

  const docs = await Promise.all(
    SAMPLE_POSTS.map(async ({ author, hoursAgo, ...fields }) => {
      const date = new Date(now.getTime() - hoursAgo * HOUR_MS);
      const post = new Post({ ...fields, author: ids[author] });
      await post.validate(); // throws a ValidationError for invalid fields
      return { ...post.toObject(), createdAt: date, updatedAt: date, [FAKE_SEED_FIELD]: true };
    }),
  );
  // One at a time, in order, so each new _id is greater than the previous one.
  for (const doc of docs) await Post.collection.insertOne(doc);
  return { authors: SAMPLE_AUTHORS.length, posts: docs.length };
}

/**
 * Removes the sample posts (only marked ones) and, unless kept, the marked sample authors.
 *
 * @param {{ keepAuthors?: boolean }} [options]
 * @returns {Promise<{ posts: number, users: number }>} What was deleted.
 */
export async function clearSamplePosts({ keepAuthors = false } = {}) {
  // The marker is not in the schema, so marker queries go to the driver directly (see fakeSeed.js).
  const authors = await User.collection
    .find({ email: { $in: SAMPLE_AUTHORS.map((a) => a.email) }, [FAKE_SEED_FIELD]: true }, { projection: { _id: 1 } })
    .toArray();
  let posts = 0;
  // One author at a time, so each delete uses the { author: 1, _id: -1 } index.
  for (const { _id } of authors) {
    posts += (await Post.collection.deleteMany({ author: _id, [FAKE_SEED_FIELD]: true })).deletedCount;
  }
  if (keepAuthors || !authors.length) return { posts, users: 0 };
  const { deletedCount } = await User.collection.deleteMany({ _id: { $in: authors.map((a) => a._id) } });
  return { posts, users: deletedCount };
}
