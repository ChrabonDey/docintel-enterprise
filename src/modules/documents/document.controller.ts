import type { Request, Response, NextFunction } from 'express';
import { DocumentService } from './document.service';
import { DocumentModel } from './document.model';
import { VerificationService } from '../validation/verification.service';
import { JobQueue } from '../jobs/queue.service';
import { NotFoundError } from '../../core/errors/app-error';

export class DocumentController {
  static async upload(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const files = req.files as Express.Multer.File[];
      const uploadedDocs = await DocumentService.uploadDocuments(files);

      res.status(201).json({
        success: true,
        message: `Successfully uploaded and queued ${uploadedDocs.length} document(s).`,
        data: uploadedDocs,
      });
    } catch (error) {
      next(error);
    }
  }

  static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { status, page, limit } = req.query as any;
      const offset = (page - 1) * limit;

      const { items, total } = DocumentModel.listAll({ status, limit, offset });

      res.status(200).json({
        success: true,
        data: items,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const details = DocumentService.getDocumentDetails(id);

      res.status(200).json({
        success: true,
        data: details,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const doc = DocumentModel.findById(id);
      if (!doc) throw new NotFoundError(`Document ${id} not found`);

      const queueStatus = JobQueue.getQueueStatus();

      res.status(200).json({
        success: true,
        data: {
          id: doc.id,
          status: doc.status,
          pageCount: doc.page_count,
          processingTimeMs: doc.processing_time_ms,
          failureReason: doc.failure_reason,
          retryCount: doc.retry_count,
          queueMetrics: queueStatus,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async applyCorrection(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const userId = req.user?.userId || 'anonymous';
      const updated = DocumentService.applyManualCorrection(id, req.body, userId);

      res.status(200).json({
        success: true,
        message: 'Manual correction saved and document re-validated successfully.',
        data: updated,
      });
    } catch (error) {
      next(error);
    }
  }

  static async reprocess(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      DocumentService.reprocessDocument(id);

      res.status(200).json({
        success: true,
        message: `Document ${id} has been re-queued for processing.`,
      });
    } catch (error) {
      next(error);
    }
  }

  static async crossVerify(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { docAId, docBId } = req.body;
      const result = await VerificationService.crossVerify(docAId, docBId);

      res.status(200).json({
        success: true,
        message: 'Cross verification completed.',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getCrossVerificationHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const history = VerificationService.getHistory();
      res.status(200).json({
        success: true,
        data: history,
      });
    } catch (error) {
      next(error);
    }
  }
}

