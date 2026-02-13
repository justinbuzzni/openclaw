/**
 * AxiomMind Error Types
 *
 * 구조화된 에러 타입 및 핸들링 유틸리티
 */

// 에러 코드 정의
export type AxiomMindErrorCode =
  | "EXTRACTION_FAILED"
  | "COMPILE_FAILED"
  | "INDEX_FAILED"
  | "SEARCH_FAILED"
  | "PROMOTION_FAILED"
  | "DEMOTION_FAILED"
  | "CONFLICT_DETECTED"
  | "CONFLICT_RESOLUTION_FAILED"
  | "SIMILARITY_CHECK_FAILED"
  | "CONFIG_ERROR"
  | "DATABASE_ERROR"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "INTERNAL_ERROR";

// 에러 상세 정보
export interface AxiomMindErrorDetails {
  code: AxiomMindErrorCode;
  message: string;
  details?: Record<string, unknown>;
  cause?: Error;
  timestamp: string;
  traceId?: string;
}

// 커스텀 에러 클래스
export class AxiomMindError extends Error {
  readonly code: AxiomMindErrorCode;
  readonly details?: Record<string, unknown>;
  readonly cause?: Error;
  readonly timestamp: string;
  readonly traceId?: string;

  constructor(
    code: AxiomMindErrorCode,
    message: string,
    options?: {
      details?: Record<string, unknown>;
      cause?: Error;
      traceId?: string;
    }
  ) {
    super(message);
    this.name = "AxiomMindError";
    this.code = code;
    this.details = options?.details;
    this.cause = options?.cause;
    this.timestamp = new Date().toISOString();
    this.traceId = options?.traceId || generateTraceId();

    // 프로토타입 체인 유지
    Object.setPrototypeOf(this, AxiomMindError.prototype);
  }

  toJSON(): AxiomMindErrorDetails {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      cause: this.cause,
      timestamp: this.timestamp,
      traceId: this.traceId,
    };
  }

  toString(): string {
    return `[${this.code}] ${this.message} (traceId: ${this.traceId})`;
  }
}

// 에러 팩토리 함수들

export function extractionError(message: string, cause?: Error): AxiomMindError {
  return new AxiomMindError("EXTRACTION_FAILED", message, { cause });
}

export function compileError(errors: string[]): AxiomMindError {
  return new AxiomMindError("COMPILE_FAILED", "Idris compilation failed", {
    details: { errors },
  });
}

export function indexError(message: string, cause?: Error): AxiomMindError {
  return new AxiomMindError("INDEX_FAILED", message, { cause });
}

export function searchError(message: string, cause?: Error): AxiomMindError {
  return new AxiomMindError("SEARCH_FAILED", message, { cause });
}

export function promotionError(entryId: string, reason: string): AxiomMindError {
  return new AxiomMindError("PROMOTION_FAILED", `Failed to promote entry ${entryId}: ${reason}`, {
    details: { entryId },
  });
}

export function demotionError(entryId: string, reason: string): AxiomMindError {
  return new AxiomMindError("DEMOTION_FAILED", `Failed to demote entry ${entryId}: ${reason}`, {
    details: { entryId },
  });
}

export function conflictDetectedError(conflicts: { id: string; type: string }[]): AxiomMindError {
  return new AxiomMindError("CONFLICT_DETECTED", `Detected ${conflicts.length} conflict(s)`, {
    details: { conflicts },
  });
}

export function configError(message: string): AxiomMindError {
  return new AxiomMindError("CONFIG_ERROR", message);
}

export function databaseError(message: string, cause?: Error): AxiomMindError {
  return new AxiomMindError("DATABASE_ERROR", message, { cause });
}

export function validationError(message: string, details?: Record<string, unknown>): AxiomMindError {
  return new AxiomMindError("VALIDATION_ERROR", message, { details });
}

export function notFoundError(resource: string, id: string): AxiomMindError {
  return new AxiomMindError("NOT_FOUND", `${resource} not found: ${id}`, {
    details: { resource, id },
  });
}

export function unauthorizedError(reason: string): AxiomMindError {
  return new AxiomMindError("UNAUTHORIZED", reason);
}

export function internalError(message: string, cause?: Error): AxiomMindError {
  return new AxiomMindError("INTERNAL_ERROR", message, { cause });
}

// 유틸리티 함수

/**
 * 트레이스 ID 생성
 */
function generateTraceId(): string {
  return `ax-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 에러가 AxiomMindError인지 확인
 */
export function isAxiomMindError(error: unknown): error is AxiomMindError {
  return error instanceof AxiomMindError;
}

/**
 * 에러를 AxiomMindError로 변환
 */
export function toAxiomMindError(error: unknown): AxiomMindError {
  if (isAxiomMindError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return new AxiomMindError("INTERNAL_ERROR", error.message, { cause: error });
  }

  return new AxiomMindError("INTERNAL_ERROR", String(error));
}

/**
 * 에러 로깅 유틸리티
 */
export function formatErrorLog(error: AxiomMindError): string {
  const parts = [
    `[${error.timestamp}]`,
    `[${error.code}]`,
    `[${error.traceId}]`,
    error.message,
  ];

  if (error.details) {
    parts.push(`| Details: ${JSON.stringify(error.details)}`);
  }

  if (error.cause) {
    parts.push(`| Cause: ${error.cause.message}`);
  }

  return parts.join(" ");
}
