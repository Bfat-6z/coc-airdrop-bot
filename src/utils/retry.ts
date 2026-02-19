import { logger } from "./logger";

export interface RetryOptions {
  maxRetries: number;
  delayMs: number;
  backoffMultiplier?: number;
  onRetry?: (attempt: number, error: Error) => void;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const { maxRetries, delayMs, backoffMultiplier = 2, onRetry } = options;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt > maxRetries) {
        break;
      }

      const waitTime = delayMs * Math.pow(backoffMultiplier, attempt - 1);
      logger.warn(
        `Attempt ${attempt}/${maxRetries + 1} failed: ${lastError.message}. Retrying in ${waitTime}ms...`
      );

      if (onRetry) {
        onRetry(attempt, lastError);
      }

      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }

  throw lastError;
}
