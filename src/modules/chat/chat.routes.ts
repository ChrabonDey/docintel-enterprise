import { Router } from 'express';
import { ChatController } from './chat.controller';
import { authenticate } from '../../core/middleware/auth.middleware';
import { validateBody } from '../../core/middleware/zod.middleware';
import { documentChatRequestSchema } from './chat.schema';

const router = Router();

// RAG Q&A Assistant endpoint (Protected by JWT or API-Key auth)
router.post('/query', authenticate, validateBody(documentChatRequestSchema), ChatController.askQuestion);

export const chatRoutes = router;
