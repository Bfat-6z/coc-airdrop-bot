import { loadConfig, CreateWalletConfig, WalletData, generatePin } from "./core/config";
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
      onRetry: (attempt, err) => {
        logger.warn(`Appium init retry ${attempt}: ${err.message}`);
      },
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

      // createWallet() handles full flow: reset -> launch -> permission -> create -> PIN -> read
      // withRetry will re-run the entire flow on failure
      let walletData: WalletData;
      try {
        walletData = await withRetry(
          () => walletCreator.createWallet(i),
          {
            maxRetries: config.timing.maxRetries,
            delayMs: 3000,
            onRetry: async (attempt, err) => {
              logger.warn(
                `Wallet #${i} creation retry ${attempt}: ${err.message}`
              );
            },
          }
        );
        successCount++;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error(
          `Wallet #${i} failed after ${config.timing.maxRetries} retries: ${errorMsg}`
        );
        walletData = {
          id: i,
          walletName: "",
          walletAddress: "",
          pin,
          createdAt: new Date().toISOString(),
          status: "failed",
          errorMessage: errorMsg,
        };
        failCount++;
      }

      // Save immediately to Excel
      await store.appendWallet(walletData);

      if (walletData.status === "created") {
        logger.info(
          `Wallet #${i} saved: ${walletData.walletName} (${walletData.walletAddress})`
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
