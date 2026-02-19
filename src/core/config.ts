import dotenv from "dotenv";
import path from "path";

dotenv.config();

export interface AccountData {
  id: number;
  email: string;
  password: string;
  walletAddress: string;
  recoveryPhrase: string;
  claimStatus: "pending" | "claimed" | "failed" | "skipped";
  claimLink: string;
  lastAttempt: string;
  errorMessage?: string;
}

export interface AppConfig {
  excelFilePath: string;
  claimLinksSheet: string;
  accountsSheet: string;
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
    actionDelay: { min: number; max: number };
    betweenAccounts: { min: number; max: number };
    maxRetries: number;
  };
  logLevel: string;
}

export function loadConfig(): AppConfig {
  return {
    excelFilePath: path.resolve(
      process.env.EXCEL_FILE_PATH || "./data/accounts.xlsx"
    ),
    accountsSheet: process.env.ACCOUNTS_SHEET || "Accounts",
    claimLinksSheet: process.env.LINKS_SHEET || "Links",
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
      actionDelay: {
        min: parseInt(process.env.ACTION_DELAY_MIN || "2000", 10),
        max: parseInt(process.env.ACTION_DELAY_MAX || "5000", 10),
      },
      betweenAccounts: {
        min: parseInt(process.env.BETWEEN_ACCOUNTS_MIN || "10000", 10),
        max: parseInt(process.env.BETWEEN_ACCOUNTS_MAX || "30000", 10),
      },
      maxRetries: parseInt(process.env.MAX_RETRIES || "3", 10),
    },
    logLevel: process.env.LOG_LEVEL || "info",
  };
}
