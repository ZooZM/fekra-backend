// src/common/filters/all-exceptions.filter.ts
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '../../generated/prisma/client';

interface ErrorBody {
  statusCode: number;
  message: string;
  errorCode: string;
  details?: unknown;
}

const DEFAULT_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
};

// Prisma codes that mean "the database is unreachable or overloaded"
const DB_UNAVAILABLE_CODES = new Set([
  'P1001', // can't reach database server
  'P1002', // database server timed out
  'P1008', // operation timed out
  'P1017', // server closed the connection
  'P2024', // connection pool timeout
]);

@Catch()
export class GeneralExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(GeneralExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    if (res.headersSent) return;

    const body = this.toBody(exception);
    this.log(exception, body, req);

    res.status(body.statusCode).json(body);
  }

  private toBody(ex: any): ErrorBody {
    // 1. Nest HTTP exceptions (including the validation pipe's)
    if (ex instanceof HttpException) {
      const status = ex.getStatus();
      const r = ex.getResponse();
      const obj =
        typeof r === 'string' ? { message: r } : (r as Record<string, any>);

      const message = Array.isArray(obj.message)
        ? obj.message.join(', ')
        : (obj.message ?? ex.message);

      return {
        statusCode: status,
        message,
        errorCode: obj.errorCode ?? DEFAULT_CODES[status] ?? 'HTTP_ERROR',
        ...(obj.details && { details: obj.details }),
      };
    }

    // 2. Prisma errors with a code (constraint violations, not found, etc.)
    if (ex instanceof Prisma.PrismaClientKnownRequestError) {
      return this.fromPrismaKnownError(ex);
    }

    // 3. Invalid query arguments or wrongly typed input reaching Prisma.
    //    Usually means DTO validation is missing or there is a bug, so the
    //    message (which contains schema details) is never sent to the client.
    if (ex instanceof Prisma.PrismaClientValidationError) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Invalid data',
        errorCode: 'VALIDATION_ERROR',
      };
    }

    // 4. Couldn't connect to / initialize the database
    if (ex instanceof Prisma.PrismaClientInitializationError) {
      return {
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'Service temporarily unavailable',
        errorCode: 'DATABASE_UNAVAILABLE',
      };
    }

    // 5. Everything else: generic 500
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      errorCode: 'INTERNAL_ERROR',
    };
  }

  private fromPrismaKnownError(
    ex: Prisma.PrismaClientKnownRequestError,
  ): ErrorBody {
    const meta = (ex.meta ?? {}) as Record<string, any>;

    switch (ex.code) {
      // Unique constraint violation
      case 'P2002': {
        const field = this.uniqueField(meta);
        return {
          statusCode: HttpStatus.CONFLICT,
          message: field
            ? `A record with this ${field} already exists`
            : 'Duplicate record',
          errorCode: 'DUPLICATE_KEY_ERROR',
          ...(field && { details: { field } }), // field name only, never the value
        };
      }

      // Record to update/delete/connect not found (findUniqueOrThrow too)
      case 'P2025':
        return {
          statusCode: HttpStatus.NOT_FOUND,
          message: 'Resource not found',
          errorCode: 'NOT_FOUND',
        };

      // Foreign key constraint failed (referenced record missing, or still in use)
      case 'P2003':
        return {
          statusCode: HttpStatus.CONFLICT,
          message: 'Operation conflicts with a related record',
          errorCode: 'FOREIGN_KEY_ERROR',
        };

      // Value too long for the column (e.g. VarChar(255))
      case 'P2000': {
        const column = meta.column_name;
        return {
          statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          message: 'A value is too long',
          errorCode: 'VALIDATION_ERROR',
          ...(column && { details: { field: String(column) } }),
        };
      }

      // Null constraint violation / missing required value
      case 'P2011':
      case 'P2012':
        return {
          statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          message: 'A required field is missing',
          errorCode: 'VALIDATION_ERROR',
        };

      // Inconsistent column data (e.g. a malformed UUID in a where clause)
      case 'P2023':
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Invalid value',
          errorCode: 'CAST_ERROR',
        };

      // Write conflict or deadlock: the client can retry
      case 'P2034':
        return {
          statusCode: HttpStatus.CONFLICT,
          message: 'Request conflicted with another operation, please retry',
          errorCode: 'TRANSACTION_CONFLICT',
        };

      default:
        if (DB_UNAVAILABLE_CODES.has(ex.code)) {
          return {
            statusCode: HttpStatus.SERVICE_UNAVAILABLE,
            message: 'Service temporarily unavailable',
            errorCode: 'DATABASE_UNAVAILABLE',
          };
        }
        return {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Internal server error',
          errorCode: 'INTERNAL_ERROR',
        };
    }
  }

  /**
   * Extracts the violated field name from a P2002 error.
   * With the pg driver adapter the shape of `meta` can differ from the
   * classic engine, so check the known places and return undefined if none match.
   */
  private uniqueField(meta: Record<string, any>): string | undefined {
    const cause = meta.driverAdapterError?.cause;
    const candidate =
      meta.target ??
      cause?.fields ??
      cause?.constraint?.fields ??
      cause?.constraint?.index ??
      cause?.constraint?.name ??
      cause?.constraint;

    const first = Array.isArray(candidate) ? candidate[0] : candidate;
    return typeof first === 'string' && first.length > 0
      ? first.replace(/"/g, '')
      : undefined;
  }

  private log(ex: any, body: ErrorBody, req: Request) {
    const line = `${req.method} ${req.url} → ${body.statusCode} ${body.errorCode}`;
    if (body.statusCode >= 500) {
      this.logger.error(`${line} - ${ex?.message}`, ex?.stack); // real cause stays in logs
    } else {
      this.logger.warn(line); // client errors: no stack, but visible in production
    }
  }
}
