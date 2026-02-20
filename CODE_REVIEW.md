# CODE REVIEW — Post-Refactor Codebase Snapshot

> Generated after PLAN_V2 refactor (wallet creation flow).
> `npx tsc --noEmit` = **PASS** (exit code 0, zero errors).

---

## File Tree

```
coc-airdrop-bot/
├── .env.example
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                          # CLI entry point
│   ├── core/
│   │   ├── config.ts                     # Types + loadConfig()
│   │   └── wallet-store.ts               # Excel read/write with rich formatting
│   ├── automation/
│   │   ├── appium-driver.ts              # WebDriverIO wrapper
│   │   ├── wallet-creator.ts             # NEW — Create wallet flow
│   │   ├── miniapp-claimer.ts            # Phase 2 (kept, not used)
│   │   ├── adb-helpers.ts                # ADB shell commands
│   │   └── screenshot.ts                 # Screenshot + UI hierarchy
│   └── utils/
│       ├── logger.ts                     # Winston logger
│       ├── delay.ts                      # randomDelay, humanType
│       └── retry.ts                      # withRetry (exponential backoff)
```

**Deleted files** (from old claim flow):
- `src/automation/base-app.ts`
- `src/core/account-manager.ts`

---

## 1. Source Files (Full Code)

### `src/core/config.ts`

```typescript
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
```

---

### `src/core/wallet-store.ts`

```typescript
import ExcelJS from "exceljs";
import path from "path";
import fs from "fs";
import { WalletData, CreateWalletConfig } from "./config";
import { logger } from "../utils/logger";

const WALLET_COLUMNS: Partial<ExcelJS.Column>[] = [
  { header: "#", key: "id", width: 6 },
  { header: "Wallet Name", key: "walletName", width: 30 },
  { header: "Wallet Address", key: "walletAddress", width: 46 },
  { header: "PIN", key: "pin", width: 10 },
  { header: "Created At", key: "createdAt", width: 22 },
  { header: "Status", key: "status", width: 12 },
];

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1F4E79" },
};

const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFFFFFFF" },
  size: 11,
};

const ZEBRA_EVEN_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFD6E4F0" },
};

const ZEBRA_ODD_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFFFFFF" },
};

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin" },
  bottom: { style: "thin" },
  left: { style: "thin" },
  right: { style: "thin" },
};

const STATUS_CREATED_FONT: Partial<ExcelJS.Font> = {
  color: { argb: "FF006100" },
  bold: true,
};

const STATUS_CREATED_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFC6EFCE" },
};

const STATUS_FAILED_FONT: Partial<ExcelJS.Font> = {
  color: { argb: "FF9C0006" },
  bold: true,
};

const STATUS_FAILED_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFFC7CE" },
};

const ADDRESS_FONT: Partial<ExcelJS.Font> = {
  name: "Consolas",
  size: 10,
};

export class WalletStore {
  private filePath: string;
  private walletsSheet: string;
  private summarySheet: string;
  private sessionStartTime: string;

  constructor(config: CreateWalletConfig) {
    this.filePath = config.excelFilePath;
    this.walletsSheet = config.walletsSheet;
    this.summarySheet = config.summarySheet;
    this.sessionStartTime = new Date().toISOString();
  }

  private ensureDirectory(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private async getWorkbook(): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();
    if (fs.existsSync(this.filePath)) {
      await workbook.xlsx.readFile(this.filePath);
    }
    return workbook;
  }

  private styleHeaderRow(sheet: ExcelJS.Worksheet): void {
    const headerRow = sheet.getRow(1);
    headerRow.eachCell((cell) => {
      cell.fill = HEADER_FILL;
      cell.font = HEADER_FONT;
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.border = THIN_BORDER;
    });
    headerRow.height = 22;
  }

  private styleDataRow(row: ExcelJS.Row, rowNumber: number): void {
    const isEven = rowNumber % 2 === 0;
    const baseFill = isEven ? ZEBRA_EVEN_FILL : ZEBRA_ODD_FILL;

    row.eachCell((cell, colNumber) => {
      cell.border = THIN_BORDER;
      cell.alignment = { vertical: "middle" };

      // Column 3 = Wallet Address → monospace font
      if (colNumber === 3) {
        cell.font = { ...ADDRESS_FONT };
      }

      // Column 4 = PIN → format as text
      if (colNumber === 4) {
        cell.numFmt = "@";
      }

      // Column 6 = Status → conditional color
      if (colNumber === 6) {
        const val = String(cell.value || "").toLowerCase();
        if (val === "created") {
          cell.font = STATUS_CREATED_FONT;
          cell.fill = STATUS_CREATED_FILL;
        } else if (val === "failed") {
          cell.font = STATUS_FAILED_FONT;
          cell.fill = STATUS_FAILED_FILL;
        } else {
          cell.fill = baseFill;
        }
        return;
      }

      cell.fill = baseFill;
    });
  }

  async initializeExcel(): Promise<void> {
    this.ensureDirectory();

    if (fs.existsSync(this.filePath)) {
      logger.info("Excel file already exists, skipping initialization");
      return;
    }

    const workbook = new ExcelJS.Workbook();

    // Create Wallets sheet
    const walletsSheet = workbook.addWorksheet(this.walletsSheet);
    walletsSheet.columns = WALLET_COLUMNS;
    this.styleHeaderRow(walletsSheet);

    // Freeze top row
    walletsSheet.views = [
      { state: "frozen", ySplit: 1, xSplit: 0, activeCell: "A2" },
    ];

    // Auto-filter on header
    walletsSheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: WALLET_COLUMNS.length },
    };

    // Create Summary sheet
    const summarySheet = workbook.addWorksheet(this.summarySheet);
    summarySheet.columns = [
      { header: "Metric", key: "metric", width: 25 },
      { header: "Value", key: "value", width: 30 },
    ];
    this.styleHeaderRow(summarySheet);
    this.writeSummaryData(summarySheet, [], this.sessionStartTime);

    await workbook.xlsx.writeFile(this.filePath);
    logger.info(`Initialized Excel file at ${this.filePath}`);
  }

  async loadWallets(): Promise<WalletData[]> {
    const workbook = await this.getWorkbook();
    const sheet = workbook.getWorksheet(this.walletsSheet);

    if (!sheet) {
      logger.warn(
        `Sheet "${this.walletsSheet}" not found. Returning empty list.`
      );
      return [];
    }

    const wallets: WalletData[] = [];

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;

      const wallet: WalletData = {
        id: Number(row.getCell(1).value) || rowNumber - 1,
        walletName: String(row.getCell(2).value || ""),
        walletAddress: String(row.getCell(3).value || ""),
        pin: String(row.getCell(4).value || ""),
        createdAt: String(row.getCell(5).value || ""),
        status: String(row.getCell(6).value || "failed") as WalletData["status"],
      };

      wallets.push(wallet);
    });

    logger.info(`Loaded ${wallets.length} wallets from Excel`);
    return wallets;
  }

  async appendWallet(wallet: WalletData): Promise<void> {
    this.ensureDirectory();
    const workbook = await this.getWorkbook();

    // Get or create Wallets sheet
    let sheet = workbook.getWorksheet(this.walletsSheet);
    if (!sheet) {
      sheet = workbook.addWorksheet(this.walletsSheet);
      sheet.columns = WALLET_COLUMNS;
      this.styleHeaderRow(sheet);
      sheet.views = [
        { state: "frozen", ySplit: 1, xSplit: 0, activeCell: "A2" },
      ];
    }

    // Append data row
    const newRow = sheet.addRow({
      id: wallet.id,
      walletName: wallet.walletName,
      walletAddress: wallet.walletAddress,
      pin: wallet.pin,
      createdAt: wallet.createdAt,
      status: wallet.status,
    });

    // Style the new row
    this.styleDataRow(newRow, newRow.number);

    // Update auto-filter to cover all data rows
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: sheet.rowCount, column: WALLET_COLUMNS.length },
    };

    // Update Summary sheet
    await this.updateSummarySheet(workbook);

    await workbook.xlsx.writeFile(this.filePath);
    logger.info(
      `Appended wallet #${wallet.id}: ${wallet.walletName} (${wallet.status})`
    );
  }

  private async updateSummarySheet(workbook: ExcelJS.Workbook): Promise<void> {
    // Load all wallet data to compute summary
    const walletsSheet = workbook.getWorksheet(this.walletsSheet);
    const wallets: WalletData[] = [];

    if (walletsSheet) {
      walletsSheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        wallets.push({
          id: Number(row.getCell(1).value) || 0,
          walletName: String(row.getCell(2).value || ""),
          walletAddress: String(row.getCell(3).value || ""),
          pin: String(row.getCell(4).value || ""),
          createdAt: String(row.getCell(5).value || ""),
          status: String(row.getCell(6).value || "failed") as WalletData["status"],
        });
      });
    }

    // Remove existing Summary sheet and recreate
    let summarySheet = workbook.getWorksheet(this.summarySheet);
    if (summarySheet) {
      workbook.removeWorksheet(summarySheet.id);
    }

    summarySheet = workbook.addWorksheet(this.summarySheet);
    summarySheet.columns = [
      { header: "Metric", key: "metric", width: 25 },
      { header: "Value", key: "value", width: 30 },
    ];
    this.styleHeaderRow(summarySheet);
    this.writeSummaryData(summarySheet, wallets, this.sessionStartTime);
  }

  private writeSummaryData(
    sheet: ExcelJS.Worksheet,
    wallets: WalletData[],
    startTime: string
  ): void {
    const total = wallets.length;
    const created = wallets.filter((w) => w.status === "created").length;
    const failed = wallets.filter((w) => w.status === "failed").length;

    const rows = [
      { metric: "Total Wallets", value: String(total) },
      { metric: "Created Successfully", value: String(created) },
      { metric: "Failed", value: String(failed) },
      {
        metric: "Success Rate",
        value: total > 0 ? `${((created / total) * 100).toFixed(1)}%` : "N/A",
      },
      { metric: "Session Start", value: startTime },
      { metric: "Last Updated", value: new Date().toISOString() },
    ];

    for (const row of rows) {
      const dataRow = sheet.addRow(row);
      const rowNum = dataRow.number;
      const isEven = rowNum % 2 === 0;

      dataRow.eachCell((cell) => {
        cell.border = THIN_BORDER;
        cell.fill = isEven ? ZEBRA_EVEN_FILL : ZEBRA_ODD_FILL;
        cell.alignment = { vertical: "middle" };
      });

      // Color the success/failed value cells
      const metricVal = String(dataRow.getCell(1).value);
      const valueCell = dataRow.getCell(2);

      if (metricVal === "Created Successfully" && created > 0) {
        valueCell.font = STATUS_CREATED_FONT;
      } else if (metricVal === "Failed" && failed > 0) {
        valueCell.font = STATUS_FAILED_FONT;
      }
    }
  }

  async exportReport(): Promise<void> {
    const wallets = await this.loadWallets();

    const total = wallets.length;
    const created = wallets.filter((w) => w.status === "created").length;
    const failed = wallets.filter((w) => w.status === "failed").length;

    logger.info("=== WALLET CREATION REPORT ===");
    logger.info(`Total wallets:  ${total}`);
    logger.info(`Created:        ${created}`);
    logger.info(`Failed:         ${failed}`);
    logger.info(
      `Success rate:   ${total > 0 ? ((created / total) * 100).toFixed(1) : 0}%`
    );
    logger.info("==============================");
  }
}
```

---

### `src/automation/wallet-creator.ts`

```typescript
import { AppiumDriver, SelectorDef } from "./appium-driver";
import { CreateWalletConfig, WalletData, generatePin } from "../core/config";
import { logger } from "../utils/logger";
import { randomDelay } from "../utils/delay";
import { takeDebugScreenshot } from "./screenshot";
import { adbClearAppData } from "./adb-helpers";

// ============================================================
// SELECTORS — Must be verified with Appium Inspector on live app.
// Use the "scan" command to discover actual selectors.
// ============================================================

const SELECTORS = {
  // Welcome screen — "Create a new wallet" button
  createNewWalletButton: [
    { strategy: "xpath", value: '//android.widget.Button[contains(@text,"Create")]' },
    { strategy: "xpath", value: '//android.widget.TextView[contains(@text,"Create a new wallet")]' },
    { strategy: "xpath", value: '//android.widget.Button[contains(@text,"Get started")]' },
    { strategy: "accessibility id", value: "Create a new wallet" },
  ] as SelectorDef[],

  // PIN input — text field (if app uses a text input for PIN)
  pinInput: [
    { strategy: "xpath", value: "//android.widget.EditText" },
    { strategy: "class name", value: "android.widget.EditText" },
  ] as SelectorDef[],

  // PIN digit buttons (if app uses a number pad)
  pinDigit: [
    { strategy: "xpath", value: '//android.widget.Button[@text="0"]' },
    { strategy: "xpath", value: '//android.widget.Button[@text="1"]' },
    { strategy: "xpath", value: '//android.widget.Button[@text="2"]' },
    { strategy: "xpath", value: '//android.widget.Button[@text="3"]' },
    { strategy: "xpath", value: '//android.widget.Button[@text="4"]' },
    { strategy: "xpath", value: '//android.widget.Button[@text="5"]' },
    { strategy: "xpath", value: '//android.widget.Button[@text="6"]' },
    { strategy: "xpath", value: '//android.widget.Button[@text="7"]' },
    { strategy: "xpath", value: '//android.widget.Button[@text="8"]' },
    { strategy: "xpath", value: '//android.widget.Button[@text="9"]' },
  ] as SelectorDef[],

  // PIN continue/confirm button
  pinContinue: [
    { strategy: "xpath", value: '//android.widget.Button[contains(@text,"Continue")]' },
    { strategy: "xpath", value: '//android.widget.Button[contains(@text,"Next")]' },
    { strategy: "xpath", value: '//android.widget.Button[contains(@text,"Confirm")]' },
  ] as SelectorDef[],

  // Wallet name on home screen (xxx.base.eth)
  walletName: [
    { strategy: "xpath", value: '//android.widget.TextView[contains(@text,".base.eth")]' },
    { strategy: "xpath", value: '//android.widget.TextView[contains(@text,"wallet")]' },
  ] as SelectorDef[],

  // Wallet address on home screen (0x...)
  walletAddress: [
    { strategy: "xpath", value: '//android.widget.TextView[starts-with(@text,"0x")]' },
    { strategy: "xpath", value: '//android.widget.TextView[string-length(@text)=42]' },
  ] as SelectorDef[],

  // Passkey creation dialog (emulator may show this)
  passkeyCreateButton: [
    { strategy: "xpath", value: '//android.widget.Button[contains(@text,"Create")]' },
    { strategy: "xpath", value: '//android.widget.Button[contains(@text,"Continue")]' },
    { strategy: "xpath", value: '//android.widget.Button[contains(@text,"Use screen lock")]' },
  ] as SelectorDef[],

  // Skip/dismiss dialogs
  skipButton: [
    { strategy: "xpath", value: '//android.widget.Button[contains(@text,"Skip")]' },
    { strategy: "xpath", value: '//android.widget.Button[contains(@text,"Not now")]' },
    { strategy: "xpath", value: '//android.widget.Button[contains(@text,"Later")]' },
  ] as SelectorDef[],
};

export class WalletCreator {
  private driver: AppiumDriver;
  private config: CreateWalletConfig;

  constructor(driver: AppiumDriver, config: CreateWalletConfig) {
    this.driver = driver;
    this.config = config;
  }

  async launch(): Promise<void> {
    logger.info("Launching Base App...");
    await this.driver.launchApp(this.config.baseApp.packageName);
    await randomDelay(3000, 5000);
    logger.info("Base App launched");
  }

  async resetApp(): Promise<void> {
    logger.info("Resetting Base App (clearing data)...");
    adbClearAppData(
      this.config.baseApp.packageName,
      this.config.appium.deviceName
    );
    await randomDelay(2000, 3000);
    logger.info("Base App data cleared");
  }

  async createWallet(index: number): Promise<WalletData> {
    const pin = generatePin(index, this.config.basePin);
    logger.info(`Creating wallet #${index}, PIN: ${pin}`);

    try {
      // Step 1: Click "Create a new wallet"
      await this.clickCreateNewWallet();
      await randomDelay(
        this.config.timing.actionDelayMin,
        this.config.timing.actionDelayMax
      );

      // Step 2: Handle passkey dialog if shown
      await this.handlePasskeyDialog();
      await randomDelay(1000, 2000);

      // Step 3: Enter PIN
      await this.enterPin(pin);
      await randomDelay(1000, 2000);

      // Step 4: Confirm PIN (may need to enter again)
      await this.confirmPin(pin);
      await randomDelay(2000, 4000);

      // Step 5: Dismiss any post-creation dialogs
      await this.dismissDialogs();
      await randomDelay(1000, 2000);

      // Step 6: Wait for wallet creation to complete
      await this.waitForWalletCreation();

      // Step 7: Read wallet info
      const walletName = await this.readWalletName();
      const walletAddress = await this.readWalletAddress();

      // Step 8: Capture screenshot
      const screenshotPath = await this.captureWalletInfo(index);
      logger.info(`Wallet screenshot: ${screenshotPath}`);

      const walletData: WalletData = {
        id: index,
        walletName,
        walletAddress,
        pin,
        createdAt: new Date().toISOString(),
        status: "created",
      };

      logger.info(
        `Wallet #${index} created: ${walletName} (${walletAddress})`
      );
      return walletData;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to create wallet #${index}: ${errorMsg}`);

      await takeDebugScreenshot(this.driver, `wallet_${index}_error`);

      return {
        id: index,
        walletName: "",
        walletAddress: "",
        pin,
        createdAt: new Date().toISOString(),
        status: "failed",
        errorMessage: errorMsg,
      };
    }
  }

  async clickCreateNewWallet(): Promise<void> {
    logger.info("Looking for 'Create a new wallet' button...");

    const btn = await this.driver.findByMultipleSelectors(
      SELECTORS.createNewWalletButton
    );

    if (!btn) {
      await takeDebugScreenshot(this.driver, "no_create_wallet_btn");
      throw new Error("'Create a new wallet' button not found on welcome screen");
    }

    await this.driver.click(btn);
    logger.info("Clicked 'Create a new wallet'");
  }

  async enterPin(pin: string): Promise<void> {
    logger.info("Entering PIN...");

    // Strategy A: Try text input field first
    const pinField = await this.driver.findByMultipleSelectors(
      SELECTORS.pinInput
    );

    if (pinField) {
      logger.info("Found PIN text input, typing PIN...");
      await this.driver.sendKeys(pinField, pin);
      await randomDelay(500, 1000);

      // Try to click continue after entering PIN
      const continueBtn = await this.driver.findByMultipleSelectors(
        SELECTORS.pinContinue
      );
      if (continueBtn) {
        await this.driver.click(continueBtn);
      }
      return;
    }

    // Strategy B: Use digit pad buttons
    logger.info("No text input found, trying digit pad...");
    await this.tapPinDigits(pin);

    await randomDelay(500, 1000);

    // Try to click continue
    const continueBtn = await this.driver.findByMultipleSelectors(
      SELECTORS.pinContinue
    );
    if (continueBtn) {
      await this.driver.click(continueBtn);
    }
  }

  async confirmPin(pin: string): Promise<void> {
    logger.info("Confirming PIN (entering again if needed)...");

    // Check if there's a new PIN input or digit pad screen (confirmation)
    await randomDelay(1000, 2000);

    const pinField = await this.driver.findByMultipleSelectors(
      SELECTORS.pinInput
    );

    if (pinField) {
      logger.info("PIN confirmation screen detected (text input)");
      await this.driver.sendKeys(pinField, pin);
      await randomDelay(500, 1000);

      const continueBtn = await this.driver.findByMultipleSelectors(
        SELECTORS.pinContinue
      );
      if (continueBtn) {
        await this.driver.click(continueBtn);
      }
      return;
    }

    // Check if digit pad is visible for confirmation
    const digitBtn = await this.driver.findByMultipleSelectors([
      SELECTORS.pinDigit[0],
    ]);

    if (digitBtn) {
      logger.info("PIN confirmation screen detected (digit pad)");
      await this.tapPinDigits(pin);

      await randomDelay(500, 1000);
      const continueBtn = await this.driver.findByMultipleSelectors(
        SELECTORS.pinContinue
      );
      if (continueBtn) {
        await this.driver.click(continueBtn);
      }
      return;
    }

    logger.info("No PIN confirmation screen detected, proceeding...");
  }

  async waitForWalletCreation(): Promise<void> {
    logger.info("Waiting for wallet creation to complete...");

    const timeout = this.config.timing.elementTimeout * 2;
    const pollInterval = 2000;
    let elapsed = 0;

    while (elapsed < timeout) {
      // Check if wallet name is visible (means wallet is created)
      const nameEl = await this.driver.findByMultipleSelectors(
        SELECTORS.walletName
      );
      if (nameEl) {
        logger.info("Wallet creation completed — home screen detected");
        return;
      }

      // Check if wallet address is visible
      const addressEl = await this.driver.findByMultipleSelectors(
        SELECTORS.walletAddress
      );
      if (addressEl) {
        logger.info("Wallet creation completed — address detected");
        return;
      }

      // Dismiss any intermediate dialogs
      await this.dismissDialogs();

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      elapsed += pollInterval;
    }

    logger.warn("Wallet creation timed out, attempting to read info anyway...");
  }

  async readWalletName(): Promise<string> {
    try {
      const el = await this.driver.findByMultipleSelectors(
        SELECTORS.walletName
      );
      if (el) {
        const text = await el.getText();
        if (text) {
          logger.info(`Wallet name: ${text}`);
          return text;
        }
      }
      logger.warn("Could not read wallet name from screen");
      return "";
    } catch (err) {
      logger.error(`Error reading wallet name: ${err}`);
      return "";
    }
  }

  async readWalletAddress(): Promise<string> {
    try {
      const el = await this.driver.findByMultipleSelectors(
        SELECTORS.walletAddress
      );
      if (el) {
        const text = await el.getText();
        if (text && text.startsWith("0x")) {
          logger.info(`Wallet address: ${text}`);
          return text;
        }
      }
      logger.warn("Could not read wallet address from screen");
      return "";
    } catch (err) {
      logger.error(`Error reading wallet address: ${err}`);
      return "";
    }
  }

  async captureWalletInfo(index: number): Promise<string> {
    return takeDebugScreenshot(this.driver, `wallet_${index}_created`);
  }

  private async handlePasskeyDialog(): Promise<void> {
    logger.debug("Checking for passkey dialog...");

    const passkeyBtn = await this.driver.findByMultipleSelectors(
      SELECTORS.passkeyCreateButton
    );

    if (passkeyBtn) {
      logger.info("Passkey dialog detected, clicking through...");
      await this.driver.click(passkeyBtn);
      await randomDelay(1000, 2000);
    }
  }

  private async dismissDialogs(): Promise<void> {
    // Try to dismiss any skip/later dialogs
    const skipBtn = await this.driver.findByMultipleSelectors(
      SELECTORS.skipButton
    );
    if (skipBtn) {
      logger.info("Dismissing dialog (Skip/Not now)...");
      await this.driver.click(skipBtn);
      await randomDelay(500, 1000);
    }
  }

  private async tapPinDigits(pin: string): Promise<void> {
    for (const digit of pin) {
      const digitIndex = parseInt(digit, 10);
      const selector = SELECTORS.pinDigit[digitIndex];

      if (!selector) {
        throw new Error(`No selector for digit ${digit}`);
      }

      const btn = await this.driver.findByMultipleSelectors([selector]);
      if (!btn) {
        throw new Error(`Digit button '${digit}' not found on screen`);
      }

      await this.driver.click(btn);
      await randomDelay(100, 300);
    }
  }
}
```

---

### `src/automation/appium-driver.ts`

```typescript
import { remote, Browser } from "webdriverio";
import { CreateWalletConfig } from "../core/config";
import { logger } from "../utils/logger";
import { adbOpenUrl } from "./adb-helpers";
import path from "path";
import fs from "fs";

export type SelectorDef = {
  strategy:
    | "xpath"
    | "id"
    | "accessibility id"
    | "class name"
    | "-android uiautomator";
  value: string;
};

// WebdriverIO v9 element type
export interface WdioElement {
  click(): Promise<void>;
  setValue(value: string): Promise<void>;
  getText(): Promise<string>;
  getAttribute(name: string): Promise<string | null>;
  isExisting(): Promise<boolean>;
  isDisplayed(): Promise<boolean>;
  waitForExist(options?: { timeout?: number }): Promise<true>;
  waitForDisplayed(options?: { timeout?: number }): Promise<true>;
}

export class AppiumDriver {
  private driver: Browser | null = null;
  private config: CreateWalletConfig;

  constructor(config: CreateWalletConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    logger.info("Initializing Appium session...");

    this.driver = await remote({
      hostname: this.config.appium.host,
      port: this.config.appium.port,
      path: "/",
      capabilities: {
        platformName: "Android",
        "appium:automationName": "UiAutomator2",
        "appium:deviceName": this.config.appium.deviceName,
        "appium:appPackage": this.config.baseApp.packageName,
        "appium:appActivity": this.config.baseApp.activityName,
        "appium:noReset": true,
        "appium:newCommandTimeout": 300,
        "appium:autoGrantPermissions": true,
      },
    });

    logger.info("Appium session initialized successfully");
  }

  private getDriver(): Browser {
    if (!this.driver) {
      throw new Error("Appium driver not initialized. Call initialize() first.");
    }
    return this.driver;
  }

  async findElement(
    strategy: string,
    selector: string,
    timeout?: number
  ): Promise<WdioElement> {
    const driver = this.getDriver();
    const element = await driver.$(this.buildSelector(strategy, selector));
    if (timeout) {
      await element.waitForExist({ timeout });
    }
    return element;
  }

  async findElements(
    strategy: string,
    selector: string
  ): Promise<WdioElement[]> {
    const driver = this.getDriver();
    const elements = await driver.$$(this.buildSelector(strategy, selector));
    return elements as unknown as WdioElement[];
  }

  async click(element: WdioElement): Promise<void> {
    await element.click();
  }

  async sendKeys(element: WdioElement, text: string): Promise<void> {
    await element.setValue(text);
  }

  async waitForElement(
    strategy: string,
    selector: string,
    timeout: number
  ): Promise<WdioElement> {
    const driver = this.getDriver();
    const element = await driver.$(this.buildSelector(strategy, selector));
    await element.waitForExist({ timeout });
    return element;
  }

  async findByMultipleSelectors(
    selectors: SelectorDef[]
  ): Promise<WdioElement | null> {
    const driver = this.getDriver();

    for (const sel of selectors) {
      try {
        const element = await driver.$(
          this.buildSelector(sel.strategy, sel.value)
        );
        const exists = await element.isExisting();
        if (exists) {
          logger.debug(
            `Found element with strategy="${sel.strategy}", value="${sel.value}"`
          );
          return element;
        }
      } catch {
        continue;
      }
    }

    logger.debug("No element found from any of the provided selectors");
    return null;
  }

  // Navigation

  async pressBack(): Promise<void> {
    const driver = this.getDriver();
    await driver.pressKeyCode(4); // KEYCODE_BACK
  }

  async pressHome(): Promise<void> {
    const driver = this.getDriver();
    await driver.pressKeyCode(3); // KEYCODE_HOME
  }

  async openDeeplink(url: string): Promise<void> {
    logger.info(`Opening deeplink: ${url}`);
    const deviceName = this.config.appium.deviceName;
    adbOpenUrl(url, deviceName);
  }

  // Gestures

  async scrollDown(): Promise<void> {
    const driver = this.getDriver();
    const { width, height } = await driver.getWindowSize();
    await driver.touchAction([
      { action: "press", x: Math.floor(width / 2), y: Math.floor(height * 0.7) },
      { action: "wait", ms: 300 },
      { action: "moveTo", x: Math.floor(width / 2), y: Math.floor(height * 0.3) },
      { action: "release" },
    ]);
  }

  async scrollUp(): Promise<void> {
    const driver = this.getDriver();
    const { width, height } = await driver.getWindowSize();
    await driver.touchAction([
      { action: "press", x: Math.floor(width / 2), y: Math.floor(height * 0.3) },
      { action: "wait", ms: 300 },
      { action: "moveTo", x: Math.floor(width / 2), y: Math.floor(height * 0.7) },
      { action: "release" },
    ]);
  }

  async swipeLeft(): Promise<void> {
    const driver = this.getDriver();
    const { width, height } = await driver.getWindowSize();
    await driver.touchAction([
      { action: "press", x: Math.floor(width * 0.8), y: Math.floor(height / 2) },
      { action: "wait", ms: 300 },
      { action: "moveTo", x: Math.floor(width * 0.2), y: Math.floor(height / 2) },
      { action: "release" },
    ]);
  }

  // Utils

  async takeScreenshot(name: string): Promise<string> {
    const driver = this.getDriver();
    const screenshotsDir = path.resolve("./screenshots");
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `${name}_${timestamp}.png`;
    const filePath = path.join(screenshotsDir, fileName);

    const base64 = await driver.takeScreenshot();
    fs.writeFileSync(filePath, Buffer.from(base64, "base64"));
    logger.info(`Screenshot saved: ${filePath}`);
    return filePath;
  }

  async getPageSource(): Promise<string> {
    const driver = this.getDriver();
    return driver.getPageSource();
  }

  async isAppInstalled(packageName: string): Promise<boolean> {
    const driver = this.getDriver();
    return driver.isAppInstalled(packageName);
  }

  async launchApp(packageName: string): Promise<void> {
    const driver = this.getDriver();
    await driver.activateApp(packageName);
  }

  async closeApp(packageName: string): Promise<void> {
    const driver = this.getDriver();
    await driver.terminateApp(packageName);
  }

  async getContexts(): Promise<string[]> {
    const driver = this.getDriver();
    return driver.getContexts() as Promise<string[]>;
  }

  async switchContext(context: string): Promise<void> {
    const driver = this.getDriver();
    await driver.switchContext(context);
  }

  async cleanup(): Promise<void> {
    if (this.driver) {
      logger.info("Cleaning up Appium session...");
      try {
        await this.driver.deleteSession();
      } catch (err) {
        logger.warn(`Error during Appium cleanup: ${err}`);
      }
      this.driver = null;
      logger.info("Appium session cleaned up");
    }
  }

  private buildSelector(strategy: string, value: string): string {
    switch (strategy) {
      case "xpath":
        return value;
      case "id":
        return `android=${value}`;
      case "accessibility id":
        return `~${value}`;
      case "class name":
        return value;
      case "-android uiautomator":
        return `android=${value}`;
      default:
        return value;
    }
  }
}
```

---

### `src/automation/miniapp-claimer.ts`

```typescript
import { AppiumDriver, SelectorDef } from "./appium-driver";
import { CreateWalletConfig } from "../core/config";
import { logger } from "../utils/logger";
import { randomDelay } from "../utils/delay";
import { takeDebugScreenshot } from "./screenshot";

export type MiniAppState =
  | "loading"
  | "signup"
  | "claim_available"
  | "already_claimed"
  | "error"
  | "unknown";

export type ClaimResult = {
  success: boolean;
  state: MiniAppState;
  error?: string;
  screenshotPath?: string;
};

// ============================================================
// SELECTORS — Must be verified with Appium Inspector / Chrome DevTools.
// MiniApps run in WebView context. Use "scan" command to discover selectors.
//
// Native selectors (for wallet confirmation popups):
const NATIVE_SELECTORS = {
  // Transaction confirmation in Base App (native popup)
  confirmTransaction: [
    { strategy: "xpath", value: '//android.widget.Button[@text="Confirm"]' },
    { strategy: "xpath", value: '//android.widget.Button[@text="Approve"]' },
    { strategy: "xpath", value: '//android.widget.Button[@text="Sign"]' },
    { strategy: "xpath", value: '//android.widget.Button[contains(@text,"Confirm")]' },
  ] as SelectorDef[],

  // Reject transaction
  rejectTransaction: [
    { strategy: "xpath", value: '//android.widget.Button[@text="Reject"]' },
    { strategy: "xpath", value: '//android.widget.Button[@text="Cancel"]' },
  ] as SelectorDef[],
};

// WebView CSS selectors (for miniapp HTML content):
const WEB_SELECTORS = {
  // Claim / Join button (CSS selectors for WebView context)
  claimButton: [
    "button.claim-btn",
    'button[data-action="claim"]',
    'a[href*="claim"]',
    "button.btn-primary",
    'button:has-text("Claim")',
    'button:has-text("Join")',
    'button:has-text("Start")',
    "[class*='claim']",
    "[class*='join']",
  ],

  // Already claimed indicator
  alreadyClaimed: [
    "[class*='claimed']",
    "[class*='success']",
    "text*='Already claimed'",
    "text*='Completed'",
  ],

  // Loading indicators
  loading: [
    "[class*='loading']",
    "[class*='spinner']",
    ".loader",
  ],

  // Error indicators
  error: [
    "[class*='error']",
    "[class*='fail']",
    ".error-message",
  ],

  // Signup form
  signup: [
    "form[class*='signup']",
    "form[class*='register']",
    'button:has-text("Sign Up")',
    'button:has-text("Register")',
  ],
};

const WEBVIEW_CONTEXT_PREFIX = "WEBVIEW_";

export class MiniAppClaimer {
  private driver: AppiumDriver;
  private config: CreateWalletConfig;

  constructor(driver: AppiumDriver, config: CreateWalletConfig) {
    this.driver = driver;
    this.config = config;
  }

  async waitForMiniAppLoad(): Promise<boolean> {
    logger.info("Waiting for miniapp to load...");

    const maxWaitMs = this.config.timing.elementTimeout * 2;
    const pollInterval = 2000;
    let elapsed = 0;

    while (elapsed < maxWaitMs) {
      // Check if a WebView context is available
      const contexts = await this.driver.getContexts();
      const webviewContext = contexts.find((c) =>
        c.startsWith(WEBVIEW_CONTEXT_PREFIX)
      );

      if (webviewContext) {
        logger.info(`WebView context found: ${webviewContext}`);

        // Switch to WebView to check if content loaded
        await this.driver.switchContext(webviewContext);

        try {
          // Check if page has loaded (not showing loading spinner)
          const state = await this.detectWebViewState();
          if (state !== "loading") {
            logger.info(`MiniApp loaded with state: ${state}`);
            // Switch back to native
            await this.driver.switchContext("NATIVE_APP");
            return true;
          }
        } catch (err) {
          logger.debug(`WebView check error: ${err}`);
        }

        // Switch back to native for next poll
        await this.driver.switchContext("NATIVE_APP");
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      elapsed += pollInterval;
    }

    logger.warn("MiniApp did not load within timeout");
    return false;
  }

  async performClaim(): Promise<ClaimResult> {
    logger.info("Starting claim flow...");

    try {
      // Wait for miniapp to load
      const loaded = await this.waitForMiniAppLoad();
      if (!loaded) {
        const screenshotPath = await takeDebugScreenshot(
          this.driver,
          "miniapp_load_timeout"
        );
        return {
          success: false,
          state: "loading",
          error: "MiniApp failed to load within timeout",
          screenshotPath,
        };
      }

      // Detect current state
      const state = await this.detectCurrentState();
      logger.info(`MiniApp current state: ${state}`);

      switch (state) {
        case "already_claimed":
          logger.info("Already claimed for this account");
          return { success: true, state: "already_claimed" };

        case "claim_available": {
          const claimed = await this.clickClaimButton();
          if (!claimed) {
            const screenshotPath = await takeDebugScreenshot(
              this.driver,
              "claim_click_failed"
            );
            return {
              success: false,
              state: "error",
              error: "Failed to click claim button",
              screenshotPath,
            };
          }

          // Handle potential transaction confirmation
          await randomDelay(2000, 4000);
          await this.confirmTransaction();

          // Verify claim success
          await randomDelay(3000, 6000);
          const verified = await this.verifyClaimSuccess();

          const screenshotPath = await takeDebugScreenshot(
            this.driver,
            verified ? "claim_success" : "claim_unverified"
          );

          return {
            success: verified,
            state: verified ? "already_claimed" : "unknown",
            screenshotPath,
          };
        }

        case "signup":
          logger.warn("Signup form detected — manual intervention needed");
          const signupScreenshot = await takeDebugScreenshot(
            this.driver,
            "miniapp_signup_needed"
          );
          return {
            success: false,
            state: "signup",
            error: "Signup form detected, cannot auto-claim",
            screenshotPath: signupScreenshot,
          };

        case "error": {
          const errorScreenshot = await takeDebugScreenshot(
            this.driver,
            "miniapp_error_state"
          );
          return {
            success: false,
            state: "error",
            error: "MiniApp is in error state",
            screenshotPath: errorScreenshot,
          };
        }

        default: {
          const unknownScreenshot = await takeDebugScreenshot(
            this.driver,
            "miniapp_unknown_state"
          );
          return {
            success: false,
            state: "unknown",
            error: `Unknown miniapp state: ${state}`,
            screenshotPath: unknownScreenshot,
          };
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(`Claim flow error: ${errorMsg}`);
      const screenshotPath = await takeDebugScreenshot(
        this.driver,
        "claim_flow_error"
      );
      return {
        success: false,
        state: "error",
        error: errorMsg,
        screenshotPath,
      };
    }
  }

  async detectCurrentState(): Promise<MiniAppState> {
    // Try to switch to WebView for inspection
    const contexts = await this.driver.getContexts();
    const webviewContext = contexts.find((c) =>
      c.startsWith(WEBVIEW_CONTEXT_PREFIX)
    );

    if (!webviewContext) {
      // No WebView available — try to detect from native elements
      return this.detectNativeState();
    }

    await this.driver.switchContext(webviewContext);
    const state = await this.detectWebViewState();
    await this.driver.switchContext("NATIVE_APP");
    return state;
  }

  private async detectWebViewState(): Promise<MiniAppState> {
    try {
      // Check for loading
      for (const selector of WEB_SELECTORS.loading) {
        try {
          const el = await this.driver.findElement("css selector", selector);
          const displayed = await el.isDisplayed();
          if (displayed) return "loading";
        } catch {
          continue;
        }
      }

      // Check for already claimed
      for (const selector of WEB_SELECTORS.alreadyClaimed) {
        try {
          const el = await this.driver.findElement("css selector", selector);
          const displayed = await el.isDisplayed();
          if (displayed) return "already_claimed";
        } catch {
          continue;
        }
      }

      // Check for error
      for (const selector of WEB_SELECTORS.error) {
        try {
          const el = await this.driver.findElement("css selector", selector);
          const displayed = await el.isDisplayed();
          if (displayed) return "error";
        } catch {
          continue;
        }
      }

      // Check for signup
      for (const selector of WEB_SELECTORS.signup) {
        try {
          const el = await this.driver.findElement("css selector", selector);
          const displayed = await el.isDisplayed();
          if (displayed) return "signup";
        } catch {
          continue;
        }
      }

      // Check for claim button
      for (const selector of WEB_SELECTORS.claimButton) {
        try {
          const el = await this.driver.findElement("css selector", selector);
          const displayed = await el.isDisplayed();
          if (displayed) return "claim_available";
        } catch {
          continue;
        }
      }

      return "unknown";
    } catch {
      return "unknown";
    }
  }

  private async detectNativeState(): Promise<MiniAppState> {
    // Fallback: try to detect state from native elements
    try {
      const pageSource = await this.driver.getPageSource();
      const sourceLower = pageSource.toLowerCase();

      if (sourceLower.includes("loading") || sourceLower.includes("spinner")) {
        return "loading";
      }
      if (sourceLower.includes("already claimed") || sourceLower.includes("completed")) {
        return "already_claimed";
      }
      if (sourceLower.includes("claim") || sourceLower.includes("join")) {
        return "claim_available";
      }
      if (sourceLower.includes("sign up") || sourceLower.includes("register")) {
        return "signup";
      }
      if (sourceLower.includes("error") || sourceLower.includes("failed")) {
        return "error";
      }
      return "unknown";
    } catch {
      return "unknown";
    }
  }

  async clickClaimButton(): Promise<boolean> {
    logger.info("Clicking claim button...");

    // Switch to WebView context
    const contexts = await this.driver.getContexts();
    const webviewContext = contexts.find((c) =>
      c.startsWith(WEBVIEW_CONTEXT_PREFIX)
    );

    if (webviewContext) {
      await this.driver.switchContext(webviewContext);

      for (const selector of WEB_SELECTORS.claimButton) {
        try {
          const el = await this.driver.findElement("css selector", selector);
          const displayed = await el.isDisplayed();
          if (displayed) {
            await this.driver.click(el);
            logger.info(`Clicked claim button with selector: ${selector}`);
            await this.driver.switchContext("NATIVE_APP");
            return true;
          }
        } catch {
          continue;
        }
      }

      await this.driver.switchContext("NATIVE_APP");
    }

    logger.warn("Could not find claim button in WebView");
    return false;
  }

  async confirmTransaction(): Promise<boolean> {
    logger.info("Checking for transaction confirmation popup...");

    // Transaction confirmation is a native Base App popup
    // Make sure we're in NATIVE_APP context
    try {
      await this.driver.switchContext("NATIVE_APP");
    } catch {
      // Already in native context
    }

    await randomDelay(1000, 2000);

    const confirmBtn = await this.driver.findByMultipleSelectors(
      NATIVE_SELECTORS.confirmTransaction
    );

    if (confirmBtn) {
      logger.info("Transaction confirmation popup found, confirming...");
      await this.driver.click(confirmBtn);
      await randomDelay(2000, 4000);
      logger.info("Transaction confirmed");
      return true;
    }

    logger.debug("No transaction confirmation popup detected");
    return false;
  }

  async verifyClaimSuccess(): Promise<boolean> {
    logger.info("Verifying claim success...");

    // Switch to WebView to check result
    const contexts = await this.driver.getContexts();
    const webviewContext = contexts.find((c) =>
      c.startsWith(WEBVIEW_CONTEXT_PREFIX)
    );

    if (webviewContext) {
      await this.driver.switchContext(webviewContext);

      // Check for success indicators
      for (const selector of WEB_SELECTORS.alreadyClaimed) {
        try {
          const el = await this.driver.findElement("css selector", selector);
          const displayed = await el.isDisplayed();
          if (displayed) {
            logger.info("Claim success verified in WebView");
            await this.driver.switchContext("NATIVE_APP");
            return true;
          }
        } catch {
          continue;
        }
      }

      await this.driver.switchContext("NATIVE_APP");
    }

    // Fallback: check native page source
    try {
      const source = await this.driver.getPageSource();
      const sourceLower = source.toLowerCase();
      if (
        sourceLower.includes("success") ||
        sourceLower.includes("claimed") ||
        sourceLower.includes("completed")
      ) {
        logger.info("Claim success verified via page source");
        return true;
      }
    } catch {
      // ignore
    }

    logger.warn("Could not verify claim success");
    return false;
  }
}
```

---

### `src/automation/screenshot.ts`

```typescript
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
```

---

### `src/automation/adb-helpers.ts`

```typescript
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
```

---

### `src/utils/logger.ts`

```typescript
import winston from "winston";

const { combine, timestamp, colorize, printf } = winston.format;

const logFormat = printf(({ level, message, timestamp, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
  return `${timestamp} [${level}]${metaStr}: ${message}`;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: combine(timestamp({ format: "YYYY-MM-DD HH:mm:ss" }), logFormat),
  transports: [
    new winston.transports.Console({
      format: combine(
        colorize(),
        timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        logFormat
      ),
    }),
  ],
});

export function setLogLevel(level: string): void {
  logger.level = level;
}
```

---

### `src/utils/delay.ts`

```typescript
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
```

---

### `src/utils/retry.ts`

```typescript
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
```

---

### `src/index.ts`

```typescript
import { loadConfig, CreateWalletConfig, generatePin } from "./core/config";
import { WalletStore } from "./core/wallet-store";
import { AppiumDriver } from "./automation/appium-driver";
import { WalletCreator } from "./automation/wallet-creator";
import { captureDebugInfo } from "./automation/screenshot";
import { adbDevices, adbDumpUI } from "./automation/adb-helpers";
import { logger, setLogLevel } from "./utils/logger";
import { randomDelay } from "./utils/delay";
import { withRetry } from "./utils/retry";
import fs from "fs";

async function runCreate(config: CreateWalletConfig): Promise<void> {
  const store = new WalletStore(config);
  await store.initializeExcel();

  // Load existing wallets to support resume
  const existingWallets = await store.loadWallets();
  const startIndex = existingWallets.length + config.startIndex;
  const endIndex = config.startIndex + config.walletCount;

  if (startIndex >= endIndex) {
    logger.info(
      `All ${config.walletCount} wallets already created (${existingWallets.length} found). Nothing to do.`
    );
    await store.exportReport();
    return;
  }

  const remaining = endIndex - startIndex;
  logger.info(
    `Creating ${remaining} wallets (index ${startIndex} to ${endIndex - 1}). ` +
      `${existingWallets.length} already exist.`
  );

  // Initialize Appium driver
  const appiumDriver = new AppiumDriver(config);
  const walletCreator = new WalletCreator(appiumDriver, config);

  try {
    await withRetry(() => appiumDriver.initialize(), {
      maxRetries: 2,
      delayMs: 3000,
      onRetry: (attempt, err) =>
        logger.warn(`Appium init retry ${attempt}: ${err.message}`),
    });

    let successCount = 0;
    let failCount = 0;

    for (let i = startIndex; i < endIndex; i++) {
      const pin = generatePin(i, config.basePin);
      logger.info("========================================");
      logger.info(
        `Wallet #${i} | PIN: ${pin} | Progress: ${i - startIndex + 1}/${remaining}`
      );
      logger.info("========================================");

      // Reset app data (clear previous wallet)
      walletCreator.resetApp();
      await randomDelay(3000, 5000);

      // Launch app fresh
      await walletCreator.launch();
      await randomDelay(2000, 4000);

      // Create wallet with retry
      const walletData = await withRetry(
        () => walletCreator.createWallet(i),
        {
          maxRetries: config.timing.maxRetries,
          delayMs: 3000,
          onRetry: async (attempt, err) => {
            logger.warn(
              `Wallet #${i} creation retry ${attempt}: ${err.message}`
            );
            // Reset app and relaunch on retry
            walletCreator.resetApp();
            await randomDelay(2000, 3000);
            await walletCreator.launch();
            await randomDelay(2000, 4000);
          },
        }
      );

      if (walletData.status === "failed") {
        failCount++;
      } else {
        successCount++;
      }

      // Save immediately to Excel
      await store.appendWallet(walletData);

      if (walletData.status === "created") {
        logger.info(
          `Wallet #${i} created: ${walletData.walletName} (${walletData.walletAddress})`
        );
      } else {
        logger.error(
          `Wallet #${i} failed: ${walletData.errorMessage || "unknown error"}`
        );
      }

      // Delay between wallets
      if (i < endIndex - 1) {
        await randomDelay(
          config.timing.betweenWalletsMin,
          config.timing.betweenWalletsMax
        );
      }
    }

    // Final report
    logger.info("========================================");
    logger.info(
      `Done! Created ${successCount} wallets, ${failCount} failed.`
    );
    logger.info("========================================");
    await store.exportReport();
  } finally {
    await appiumDriver.cleanup();
  }
}

async function runScan(config: CreateWalletConfig): Promise<void> {
  logger.info("=== SCAN MODE: Discovering UI selectors ===");

  const devices = adbDevices();
  logger.info(`Connected devices: ${devices.join(", ") || "none"}`);

  if (devices.length === 0) {
    logger.error("No Android devices connected. Start an emulator first.");
    return;
  }

  const appiumDriver = new AppiumDriver(config);

  try {
    await appiumDriver.initialize();

    // Take screenshot of current state
    const { screenshotPath, hierarchyPath } = await captureDebugInfo(
      appiumDriver,
      "scan_initial"
    );
    logger.info(`Screenshot: ${screenshotPath}`);
    logger.info(`UI Hierarchy: ${hierarchyPath}`);

    // ADB UI dump
    const debugDir = "./debug";
    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir, { recursive: true });
    }
    adbDumpUI("./debug/adb_ui_dump.xml", config.appium.deviceName);
    logger.info("ADB UI dump saved to ./debug/adb_ui_dump.xml");

    // Check for WebView contexts
    const contexts = await appiumDriver.getContexts();
    logger.info(`Available contexts: ${JSON.stringify(contexts)}`);

    if (contexts.length > 1) {
      for (const ctx of contexts) {
        if (ctx.startsWith("WEBVIEW_")) {
          logger.info(`Switching to WebView: ${ctx}`);
          await appiumDriver.switchContext(ctx);
          const source = await appiumDriver.getPageSource();
          const savePath = `./debug/webview_source_${ctx.replace(/[^a-zA-Z0-9]/g, "_")}.html`;
          fs.writeFileSync(savePath, source, "utf-8");
          logger.info(`WebView source saved: ${savePath}`);
          await appiumDriver.switchContext("NATIVE_APP");
        }
      }
    }

    logger.info(
      "=== Scan complete. Check ./debug/ and ./screenshots/ folders ==="
    );
  } finally {
    await appiumDriver.cleanup();
  }
}

async function runStatus(config: CreateWalletConfig): Promise<void> {
  const store = new WalletStore(config);
  await store.exportReport();
}

async function runReset(config: CreateWalletConfig): Promise<void> {
  if (fs.existsSync(config.excelFilePath)) {
    fs.unlinkSync(config.excelFilePath);
    logger.info(`Deleted Excel file: ${config.excelFilePath}`);
  } else {
    logger.info("No Excel file found. Nothing to reset.");
  }
}

async function runTest(config: CreateWalletConfig): Promise<void> {
  logger.info("=== CONNECTION TEST ===");

  // Test ADB
  logger.info("Checking ADB devices...");
  const devices = adbDevices();
  if (devices.length === 0) {
    logger.error("FAIL: No Android devices connected");
  } else {
    logger.info(`OK: Devices found: ${devices.join(", ")}`);
  }

  // Test Appium
  logger.info("Testing Appium connection...");
  const appiumDriver = new AppiumDriver(config);

  try {
    await appiumDriver.initialize();
    logger.info("OK: Appium session created successfully");

    const installed = await appiumDriver.isAppInstalled(
      config.baseApp.packageName
    );
    if (installed) {
      logger.info(`OK: ${config.baseApp.packageName} is installed`);
    } else {
      logger.error(
        `FAIL: ${config.baseApp.packageName} is NOT installed on device`
      );
    }

    const screenshotPath = await appiumDriver.takeScreenshot("test_connection");
    logger.info(`OK: Screenshot saved to ${screenshotPath}`);
  } catch (err) {
    logger.error(`FAIL: Appium connection failed: ${err}`);
  } finally {
    await appiumDriver.cleanup();
  }

  // Test Excel
  logger.info("Testing Excel access...");
  const store = new WalletStore(config);
  try {
    await store.initializeExcel();
    const wallets = await store.loadWallets();
    logger.info(`OK: Excel loaded, ${wallets.length} wallets found`);
  } catch (err) {
    logger.error(`FAIL: Excel access failed: ${err}`);
  }

  logger.info("=== TEST COMPLETE ===");
}

function printUsage(): void {
  console.log(`
COC-AIRDROP-BOT — Wallet Creation Automation

Usage: npm start <command>

Commands:
  create    Create new wallets on Base App (main command)
  scan      Discover UI selectors on live emulator (debug mode)
  status    Show wallet creation summary from Excel
  reset     Delete Excel data file (start fresh)
  test      Test connection to emulator + Base App

Examples:
  npm start create
  npm start scan
  npm start status
  npm start test

Setup:
  1. Copy .env.example to .env and configure
  2. Start Android emulator with Base App installed
  3. Start Appium server: appium
  4. Run: npm start create
`);
}

async function main(): Promise<void> {
  const command = process.argv[2];

  if (!command) {
    printUsage();
    process.exit(0);
  }

  const config = loadConfig();
  setLogLevel(config.logLevel);

  logger.info(`COC-AIRDROP-BOT starting... command: ${command}`);

  try {
    switch (command) {
      case "create":
        await runCreate(config);
        break;
      case "scan":
        await runScan(config);
        break;
      case "status":
        await runStatus(config);
        break;
      case "reset":
        await runReset(config);
        break;
      case "test":
        await runTest(config);
        break;
      default:
        logger.error(`Unknown command: ${command}`);
        printUsage();
        process.exit(1);
    }
  } catch (err) {
    logger.error(`Fatal error: ${err}`);
    process.exit(1);
  }
}

main();
```

---

## 2. TypeScript Compilation Result

```
$ npx tsc --noEmit
(no output — exit code 0)
```

**PASS** — zero errors, zero warnings.

---

## 3. `.env.example`

```env
# === WALLET CREATION ===
WALLET_COUNT=10
START_INDEX=1
BASE_PIN=632700

# === EXCEL ===
EXCEL_FILE_PATH=./data/wallets.xlsx
WALLETS_SHEET=Wallets
SUMMARY_SHEET=Summary

# === APPIUM ===
APPIUM_HOST=localhost
APPIUM_PORT=4723
ANDROID_DEVICE_NAME=emulator-5554

# === BASE APP ===
BASE_APP_PACKAGE=org.toshi
BASE_APP_ACTIVITY=.MainActivity

# === TIMING (ms) ===
ELEMENT_TIMEOUT=15000
ACTION_DELAY_MIN=2000
ACTION_DELAY_MAX=5000
BETWEEN_WALLETS_MIN=5000
BETWEEN_WALLETS_MAX=10000
MAX_RETRIES=3

# === LOGGING ===
LOG_LEVEL=info
```

---

## 4. `package.json`

```json
{
  "name": "coc-airdrop-bot",
  "version": "1.0.0",
  "description": "CLI automation tool for Base App wallet creation on Android Emulator",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "ts-node src/index.ts",
    "dev": "ts-node src/index.ts",
    "create": "ts-node src/index.ts create",
    "scan": "ts-node src/index.ts scan",
    "status": "ts-node src/index.ts status",
    "reset": "ts-node src/index.ts reset",
    "test:connection": "ts-node src/index.ts test"
  },
  "dependencies": {
    "webdriverio": "^9.0.0",
    "exceljs": "^4.4.0",
    "winston": "^3.11.0",
    "dotenv": "^16.3.1"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "ts-node": "^10.9.0",
    "@types/node": "^20.10.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

---

## 5. `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

