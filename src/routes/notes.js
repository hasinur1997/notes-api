/**
 * /api/notes routes. Every route requires authentication.
 * Static paths (/summary, /labels/:name) are registered before /:id so they are not read as ids.
 */
import { Router } from 'express';
import * as notes from '../controllers/notesController.js';
import { auth } from '../middleware/auth.js';
import { imageUpload, uploadLimiter } from '../middleware/upload.js';
import { idParams, validate } from '../middleware/validate.js';
import {
  addCollaboratorBody,
  collaboratorParams,
  createNoteBody,
  imageParams,
  labelParams,
  listNotesQuery,
  renameLabelBody,
  updateNoteBody,
} from '../validators/notes.js';

const router = Router();

router.use(auth);

router.get('/', validate({ query: listNotesQuery }), notes.listNotes);
router.post('/', validate({ body: createNoteBody }), notes.createNote);

router.get('/summary', notes.getSummary);
router.post('/labels', validate({ body: renameLabelBody }), notes.createLabel);
router.patch('/labels/:name', validate({ params: labelParams, body: renameLabelBody }), notes.renameLabel);
router.delete('/labels/:name', validate({ params: labelParams }), notes.deleteLabel);

router.get('/:id', validate({ params: idParams }), notes.getNote);
router.patch('/:id', validate({ params: idParams, body: updateNoteBody }), notes.updateNote);
router.delete('/:id', validate({ params: idParams }), notes.deleteNote);
router.post('/:id/copy', validate({ params: idParams }), notes.copyNote);

router.post('/:id/collaborators', validate({ params: idParams, body: addCollaboratorBody }), notes.addCollaborator);
router.delete('/:id/collaborators/:userId', validate({ params: collaboratorParams }), notes.removeCollaborator);

// Params are validated before the upload is read, so invalid requests never buffer a file.
router.post('/:id/images', uploadLimiter, validate({ params: idParams }), imageUpload, notes.addImage);
router.delete('/:id/images/:imageId', validate({ params: imageParams }), notes.removeImage);

export default router;
