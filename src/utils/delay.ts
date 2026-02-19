import { logger } from "./logger";

export async function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  logger.debug(`Waiting ${delay}ms...`);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

export async function humanType(
  sendKeysFn: (text: string) => Promise<void>,
  text: string
): Promise<void> {
  for (const char of text) {
    await sendKeysFn(char);
    const charDelay = Math.floor(Math.random() * 100) + 50; // 50-150ms
    await new Promise((resolve) => setTimeout(resolve, charDelay));
  }
}
