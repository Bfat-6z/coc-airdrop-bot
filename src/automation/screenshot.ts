import path from "path";
import fs from "fs";
import { AppiumDriver } from "./appium-driver";
import { logger } from "../utils/logger";

const SCREENSHOTS_DIR = path.resolve("./screenshots");
const DEBUG_DIR = path.resolve("./debug");

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export async function takeDebugScreenshot(
  driver: AppiumDriver,
  name: string
): Promise<string> {
  try {
    ensureDir(SCREENSHOTS_DIR);
    return await driver.takeScreenshot(name);
  } catch (err) {
    logger.error(`Failed to take screenshot "${name}": ${err}`);
    return "";
  }
}

export async function saveUIHierarchy(
  driver: AppiumDriver,
  name: string
): Promise<string> {
  try {
    ensureDir(DEBUG_DIR);

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `${name}_${timestamp}.xml`;
    const filePath = path.join(DEBUG_DIR, fileName);

    const source = await driver.getPageSource();
    fs.writeFileSync(filePath, source, "utf-8");
    logger.info(`UI hierarchy saved: ${filePath}`);
    return filePath;
  } catch (err) {
    logger.error(`Failed to save UI hierarchy "${name}": ${err}`);
    return "";
  }
}

export async function captureDebugInfo(
  driver: AppiumDriver,
  name: string
): Promise<{ screenshotPath: string; hierarchyPath: string }> {
  const [screenshotPath, hierarchyPath] = await Promise.all([
    takeDebugScreenshot(driver, name),
    saveUIHierarchy(driver, name),
  ]);
  return { screenshotPath, hierarchyPath };
}
