/**
 * /api/admin routes. Every route requires a signed-in admin (role read from the database).
 */
import { Router } from 'express';
import * as admin from '../controllers/adminController.js';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { idParams, validate } from '../middleware/validate.js';
import {
  createUserBody,
  interestGroupsQuery,
  listAllNotesQuery,
  listUsersQuery,
  updateUserBody,
  userNotesQuery,
} from '../validators/admin.js';

const router = Router();

router.use(auth, requireRole('admin'));

router.get('/users', validate({ query: listUsersQuery }), admin.listUsers);
router.post('/users', validate({ body: createUserBody }), admin.createUser);
// Registered before /users/:id so "grouped-by-interest" is not read as an id.
router.get('/users/grouped-by-interest', validate({ query: interestGroupsQuery }), admin.listInterestGroups);
router.get('/users/:id', validate({ params: idParams }), admin.getUser);
router.patch('/users/:id', validate({ params: idParams, body: updateUserBody }), admin.updateUser);
router.delete('/users/:id', validate({ params: idParams }), admin.deleteUser);
router.get('/users/:id/notes', validate({ params: idParams, query: userNotesQuery }), admin.listUserNotes);

router.get('/notes', validate({ query: listAllNotesQuery }), admin.listAllNotes);

export default router;
