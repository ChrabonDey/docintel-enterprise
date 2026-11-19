import { Request, Response, NextFunction } from 'express';
import { ChatService } from './chat.service';
import type { DocumentChatRequest } from './chat.schema';

export class ChatController {
  static async askQuestion(req: Request, res: Response, next: NextFunction) {
    try {
      const payload: DocumentChatRequest = req.body;
      const result = await ChatService.query(payload);
      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}
