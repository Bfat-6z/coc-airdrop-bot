import dotenv from "dotenv";
import path from "path";

dotenv.config();

export interface WalletData {
  id: number;
  walletName: string;
  walletAddress: string;
  pin: string;
  createdAt: string;
  status: "created" | "failed";
  errorMessage?: string;
}

export interface CreateWalletConfig {
  walletCount: number;
  startIndex: number;
  basePin: number;
  excelFilePath: string;
  walletsSheet: string;
  summarySheet: string;
  appium: {
    host: string;
    port: number;
    deviceName: string;
  };
  baseApp: {
    packageName: string;
    activityName: string;
  };
  timing: {
    elementTimeout: number;
    actionDelayMin: number;
    actionDelayMax: number;
    betweenWalletsMin: number;
    betweenWalletsMax: number;
    maxRetries: number;
  };
  logLevel: string;
}

export function generatePin(index: number, basePin: number = 632700): string {
  return String(basePin + index).padStart(6, "0");
}

export function loadConfig(): CreateWalletConfig {
  return {
    walletCount: parseInt(process.env.WALLET_COUNT || "10", 10),
    startIndex: parseInt(process.env.START_INDEX || "1", 10),
    basePin: parseInt(process.env.BASE_PIN || "632700", 10),
    excelFilePath: path.resolve(
      process.env.EXCEL_FILE_PATH || "./data/wallets.xlsx"
    ),
    walletsSheet: process.env.WALLETS_SHEET || "Wallets",
    summarySheet: process.env.SUMMARY_SHEET || "Summary",
    appium: {
      host: process.env.APPIUM_HOST || "localhost",
      port: parseInt(process.env.APPIUM_PORT || "4723", 10),
      deviceName: process.env.ANDROID_DEVICE_NAME || "emulator-5554",
    },
    baseApp: {
      packageName: process.env.BASE_APP_PACKAGE || "org.toshi",
      activityName: process.env.BASE_APP_ACTIVITY || ".MainActivity",
    },
    timing: {
      elementTimeout: parseInt(process.env.ELEMENT_TIMEOUT || "15000", 10),
      actionDelayMin: parseInt(process.env.ACTION_DELAY_MIN || "2000", 10),
      actionDelayMax: parseInt(process.env.ACTION_DELAY_MAX || "5000", 10),
      betweenWalletsMin: parseInt(
        process.env.BETWEEN_WALLETS_MIN || "5000",
        10
      ),
      betweenWalletsMax: parseInt(
        process.env.BETWEEN_WALLETS_MAX || "10000",
        10
      ),
      maxRetries: parseInt(process.env.MAX_RETRIES || "3", 10),
    },
    logLevel: process.env.LOG_LEVEL || "info",
  };
}
