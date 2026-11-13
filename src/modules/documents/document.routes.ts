import { Router } from 'express';
import { DocumentController } from './document.controller';
import { uploadMiddleware } from '../../core/middleware/upload.middleware';
import { authenticate, authorizeRoles } from '../../core/middleware/auth.middleware';
import { validateBody, validateQuery, validateParams } from '../../core/middleware/zod.middleware';
import {
  manualCorrectionSchema,
  crossVerifySchema,
  documentListQuerySchema,
  documentIdParamSchema,
} from './document.schema';

const router = Router();

// Document uploads (supports single and multiple file uploads)
router.post(
  '/upload',
  authenticate,
  uploadMiddleware.array('files', 20),
  DocumentController.upload
);

// List all documents with filters & pagination (validated query)
router.get('/', authenticate, validateQuery(documentListQuerySchema), DocumentController.list);

// Cross-verification endpoints
router.post(
  '/cross-verify',
  authenticate,
  validateBody(crossVerifySchema),
  DocumentController.crossVerify
);

router.get('/cross-verify/history', authenticate, DocumentController.getCrossVerificationHistory);

// Document specific endpoints (validated params)
router.get('/:id', authenticate, validateParams(documentIdParamSchema), DocumentController.getById);
router.get('/:id/status', authenticate, validateParams(documentIdParamSchema), DocumentController.getStatus);

// Manual corrections (restricted to ADMIN and ANALYST roles, validated params and body)
router.put(
  '/:id/corrections',
  authenticate,
  authorizeRoles('ADMIN', 'ANALYST'),
  validateParams(documentIdParamSchema),
  validateBody(manualCorrectionSchema),
  DocumentController.applyCorrection
);

// Reprocess document
router.post('/:id/reprocess', authenticate, validateParams(documentIdParamSchema), DocumentController.reprocess);

export const documentRoutes = router;

