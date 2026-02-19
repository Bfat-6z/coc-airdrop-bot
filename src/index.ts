import { loadConfig, AppConfig } from "./core/config";
import { AccountManager } from "./core/account-manager";
import { WalletStore } from "./core/wallet-store";
import { AppiumDriver } from "./automation/appium-driver";
import { BaseAppController } from "./automation/base-app";
import { MiniAppClaimer } from "./automation/miniapp-claimer";
import { captureDebugInfo } from "./automation/screenshot";
import { adbDevices, adbDumpUI } from "./automation/adb-helpers";
import { logger, setLogLevel } from "./utils/logger";
import { randomDelay } from "./utils/delay";
import { withRetry } from "./utils/retry";

async function runClaim(config: AppConfig): Promise<void> {
  const manager = new AccountManager(config);
  await manager.initializeExcel();

  // 1. Load pending accounts
  const pendingAccounts = await manager.loadPendingAccounts();
  if (pendingAccounts.length === 0) {
    logger.info("No pending accounts found. Nothing to do.");
    return;
  }

  // 2. Load claim links
  const store = manager.getStore();
  const links = await store.loadClaimLinks();
  if (links.length === 0) {
    logger.warn("No claim links found in Excel. Using account-assigned links.");
  } else {
    manager.assignLinksToAccounts(pendingAccounts, links);
  }

  // 3. Initialize Appium driver
  const appiumDriver = new AppiumDriver(config);
  const baseApp = new BaseAppController(appiumDriver, config);
  const claimer = new MiniAppClaimer(appiumDriver, config);

  try {
    await withRetry(() => appiumDriver.initialize(), {
      maxRetries: 2,
      delayMs: 3000,
      onRetry: (attempt, err) =>
        logger.warn(`Appium init retry ${attempt}: ${err.message}`),
    });

    let isFirstAccount = true;
    let account = await manager.getNextAccount();

    // 4. Process each account
    while (account !== null) {
      logger.info("========================================");
      logger.info(
        `Processing account #${account.id}: ${account.email} (${manager.getPendingCount()} remaining)`
      );
      logger.info("========================================");

      try {
        // Logout previous account if not first
        if (!isFirstAccount) {
          await baseApp.logout();
          await randomDelay(
            config.timing.betweenAccounts.min,
            config.timing.betweenAccounts.max
          );
        }
        isFirstAccount = false;

        // Launch Base App
        await baseApp.launch();
        await randomDelay(
          config.timing.actionDelay.min,
          config.timing.actionDelay.max
        );

        // Login
        const loginResult = await withRetry(
          async () => {
            const success = await baseApp.login(
              account!.email,
              account!.password
            );
            if (!success) throw new Error("Login failed");
            return success;
          },
          {
            maxRetries: config.timing.maxRetries,
            delayMs: 3000,
            onRetry: (attempt) =>
              logger.warn(
                `Login retry ${attempt} for ${account!.email}`
              ),
          }
        );

        if (!loginResult) {
          throw new Error("Login failed after all retries");
        }

        // Get wallet address
        const walletAddress = await baseApp.getWalletAddress();
        if (walletAddress) {
          account.walletAddress = walletAddress;
          logger.info(`Wallet address: ${walletAddress}`);
        }

        // Open claim link
        const claimLink =
          account.claimLink || "https://clashofcoins.com/agentic";
        await baseApp.openMiniAppLink(claimLink);

        // Perform claim
        const claimResult = await withRetry(
          () => claimer.performClaim(),
          {
            maxRetries: config.timing.maxRetries,
            delayMs: 5000,
            onRetry: (attempt) =>
              logger.warn(`Claim retry ${attempt} for ${account!.email}`),
          }
        );

        // Update status
        if (claimResult.success) {
          await manager.updateStatus(account.id, "claimed");
          logger.info(`Account #${account.id} claimed successfully!`);
        } else if (claimResult.state === "already_claimed") {
          await manager.updateStatus(account.id, "claimed");
          logger.info(`Account #${account.id} already claimed`);
        } else {
          await manager.updateStatus(
            account.id,
            "failed",
            claimResult.error
          );
          logger.error(
            `Account #${account.id} claim failed: ${claimResult.error}`
          );
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error(`Account #${account.id} error: ${errorMsg}`);
        await manager.updateStatus(account.id, "failed", errorMsg);

        // Take error screenshot
        try {
          await captureDebugInfo(
            appiumDriver,
            `error_account_${account.id}`
          );
        } catch {
          // ignore screenshot errors
        }
      }

      // Navigate home before next account
      try {
        await baseApp.goHome();
      } catch {
        // ignore
      }

      account = await manager.getNextAccount();
    }

    // 5. Generate report
    await manager.exportReport();
  } finally {
    await appiumDriver.cleanup();
  }
}

async function runScan(config: AppConfig): Promise<void> {
  logger.info("=== SCAN MODE: Discovering UI selectors ===");

  // Check ADB devices
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

    // Dump UI via ADB
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
          const fs = await import("fs");
          const savePath = `./debug/webview_source_${ctx.replace(/[^a-zA-Z0-9]/g, "_")}.html`;
          fs.writeFileSync(savePath, source, "utf-8");
          logger.info(`WebView source saved: ${savePath}`);
          await appiumDriver.switchContext("NATIVE_APP");
        }
      }
    }

    logger.info("=== Scan complete. Check ./debug/ and ./screenshots/ folders ===");
  } finally {
    await appiumDriver.cleanup();
  }
}

async function runStatus(config: AppConfig): Promise<void> {
  const store = new WalletStore(config);
  await store.exportReport();
}

async function runReset(config: AppConfig): Promise<void> {
  const store = new WalletStore(config);
  const accounts = await store.loadAccounts();

  if (accounts.length === 0) {
    logger.info("No accounts found in Excel.");
    return;
  }

  for (const account of accounts) {
    account.claimStatus = "pending";
    account.errorMessage = undefined;
    account.lastAttempt = "";
  }

  await store.saveAccounts(accounts);
  logger.info(`Reset ${accounts.length} accounts to "pending" status`);
}

async function runTest(config: AppConfig): Promise<void> {
  logger.info("=== CONNECTION TEST ===");

  // Test ADB
  logger.info("Checking ADB devices...");
  const devices = adbDevices();
  if (devices.length === 0) {
    logger.error("FAIL: No Android devices connected");
  } else {
    logger.info(`OK: Devices found: ${devices.join(", ")}`);
  }

  // Test Appium connection
  logger.info("Testing Appium connection...");
  const appiumDriver = new AppiumDriver(config);

  try {
    await appiumDriver.initialize();
    logger.info("OK: Appium session created successfully");

    // Check if Base App is installed
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

    // Take a test screenshot
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
    const accounts = await store.loadAccounts();
    logger.info(`OK: Excel loaded, ${accounts.length} accounts found`);
  } catch (err) {
    logger.error(`FAIL: Excel access failed: ${err}`);
  }

  logger.info("=== TEST COMPLETE ===");
}

function printUsage(): void {
  console.log(`
COC-AIRDROP-BOT — Clash of Coins Airdrop Automation

Usage: npm start <command>

Commands:
  claim     Run claim flow for all pending accounts
  scan      Discover UI selectors on live emulator (debug mode)
  status    Show claim status summary from Excel
  reset     Reset all account statuses to "pending"
  test      Test connection to emulator + Base App

Examples:
  npm start claim
  npm start scan
  npm start status
  npm start test

Setup:
  1. Copy .env.example to .env and configure
  2. Start Android emulator with Base App installed
  3. Start Appium server: appium
  4. Fill in accounts.xlsx with account data
  5. Run: npm start claim
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
      case "claim":
        await runClaim(config);
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
