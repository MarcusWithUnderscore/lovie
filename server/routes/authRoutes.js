import express from 'express';
import { login, getCurrentUser } from '../controllers/authController.js';
import { auth } from '../middleware/auth.js';

const router = express.Router();

router.post('/login', login);
router.get('/me', auth, getCurrentUser);

export default router;