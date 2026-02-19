import { execSync } from "child_process";
import { logger } from "../utils/logger";

function adbCmd(args: string, deviceId?: string): string {
  const deviceFlag = deviceId ? `-s ${deviceId}` : "";
  const cmd = `adb ${deviceFlag} ${args}`;
  logger.debug(`ADB: ${cmd}`);
  try {
    return execSync(cmd, { encoding: "utf-8", timeout: 30000 }).trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`ADB command failed: ${cmd} — ${msg}`);
    throw err;
  }
}

export function adbOpenUrl(url: string, deviceId?: string): void {
  adbCmd(
    `shell am start -a android.intent.action.VIEW -d "${url}"`,
    deviceId
  );
}

export function adbTap(x: number, y: number, deviceId?: string): void {
  adbCmd(`shell input tap ${x} ${y}`, deviceId);
}

export function adbType(text: string, deviceId?: string): void {
  const escaped = text.replace(/(["\s&|<>^;])/g, "\\$1");
  adbCmd(`shell input text "${escaped}"`, deviceId);
}

export function adbKey(keycode: number, deviceId?: string): void {
  adbCmd(`shell input keyevent ${keycode}`, deviceId);
}

// Common keycodes
export const ADB_KEYS = {
  BACK: 4,
  HOME: 3,
  ENTER: 66,
  TAB: 61,
  DELETE: 67,
  MENU: 82,
} as const;

export function adbScreenshot(savePath: string, deviceId?: string): void {
  const remotePath = "/sdcard/tmp_screenshot.png";
  adbCmd(`shell screencap ${remotePath}`, deviceId);
  adbCmd(`pull ${remotePath} "${savePath}"`, deviceId);
  adbCmd(`shell rm ${remotePath}`, deviceId);
}

export function adbDumpUI(savePath: string, deviceId?: string): void {
  const remotePath = "/sdcard/ui_dump.xml";
  adbCmd(`shell uiautomator dump ${remotePath}`, deviceId);
  adbCmd(`pull ${remotePath} "${savePath}"`, deviceId);
  adbCmd(`shell rm ${remotePath}`, deviceId);
}

export function adbIsAppRunning(
  packageName: string,
  deviceId?: string
): boolean {
  try {
    const output = adbCmd(
      `shell pidof ${packageName}`,
      deviceId
    );
    return output.length > 0;
  } catch {
    return false;
  }
}

export function adbForceStop(
  packageName: string,
  deviceId?: string
): void {
  adbCmd(`shell am force-stop ${packageName}`, deviceId);
}

export function adbClearAppData(
  packageName: string,
  deviceId?: string
): void {
  adbCmd(`shell pm clear ${packageName}`, deviceId);
}

export function adbDevices(): string[] {
  const output = adbCmd("devices");
  const lines = output.split("\n").slice(1); // Skip header line
  return lines
    .map((line) => line.split("\t")[0])
    .filter((id) => id && id.length > 0);
}

export function adbInstall(apkPath: string, deviceId?: string): void {
  adbCmd(`install -r "${apkPath}"`, deviceId);
}
