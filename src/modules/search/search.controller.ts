import type { Request, Response, NextFunction } from 'express';
import { SearchService } from './search.service';
import type { SearchQueryInput } from './search.schema';

export class SearchController {
  static async search(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // req.query is validated and typed by validateQuery(searchQuerySchema)
      const filters = req.query as unknown as SearchQueryInput;
      const searchOutput = SearchService.search(filters);

      res.status(200).json({
        success: true,
        data: searchOutput.results,
        pagination: searchOutput.pagination,
      });
    } catch (error) {
      next(error);
    }
  }
}
