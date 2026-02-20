import { AppiumDriver, SelectorDef } from "./appium-driver";
import { CreateWalletConfig, WalletData, generatePin } from "../core/config";
import { logger } from "../utils/logger";
import { randomDelay } from "../utils/delay";
import { takeDebugScreenshot } from "./screenshot";
import { adbClearAppData } from "./adb-helpers";
import path from "path";
import fs from "fs";

const DEBUG_DIR = path.resolve("./debug");

// ============================================================
// SELECTORS — Verified from UI scan of Base App (org.toshi)
// Welcome screen + Permission dialog confirmed.
// PIN screen + Wallet home: fallback selectors (not yet scanned).
// ============================================================

const SELECTORS = {
  // Welcome screen — "Create Account" button
  // Confirmed: resource-id="sign-up-button", content-desc="Create Account"
  createNewWalletButton: [
    { strategy: "accessibility id", value: "Create Account" },
    { strategy: "xpath", value: '//*[@resource-id="sign-up-button"]' },
    { strategy: "xpath", value: '//android.widget.Button[contains(@text,"Create")]' },
    { strategy: "xpath", value: '//android.widget.Button[contains(@content-desc,"Create Account")]' },
  ] as SelectorDef[],

  // Welcome screen container
  // Confirmed: resource-id="signed-out-home-screen"
  welcomeScreen: [
    { strategy: "xpath", value: '//*[@resource-id="signed-out-home-screen"]' },
  ] as SelectorDef[],

  // Android permission dialog — Allow button
  // Confirmed: resource-id="com.android.permissioncontroller:id/permission_allow_button"
  permissionAllowButton: [
    { strategy: "xpath", value: '//*[@resource-id="com.android.permissioncontroller:id/permission_allow_button"]' },
    { strategy: "xpath", value: '//android.widget.Button[@text="Allow"]' },
    { strategy: "xpath", value: '//android.widget.Button[contains(@text,"Allow")]' },
  ] as SelectorDef[],

  // PIN input — text field (fallback, PIN screen not yet scanned)
  pinInput: [
    { strategy: "xpath", value: "//android.widget.EditText" },
    { strategy: "class name", value: "android.widget.EditText" },
  ] as SelectorDef[],

  // PIN continue/confirm button
  pinContinue: [
    { strategy: "xpath", value: '//android.widget.Button[contains(@text,"Continue")]' },
    { strategy: "xpath", value: '//android.widget.Button[contains(@text,"Next")]' },
    { strategy: "xpath", value: '//android.widget.Button[contains(@text,"Confirm")]' },
  ] as SelectorDef[],

  // Wallet name on home screen (xxx.base.eth or xxx.base)
  walletName: [
    { strategy: "xpath", value: '//android.widget.TextView[contains(@text,".base.eth")]' },
    { strategy: "xpath", value: '//android.widget.TextView[contains(@text,".base")]' },
  ] as SelectorDef[],

  // Wallet address on home screen (0x...)
  walletAddress: [
    { strategy: "xpath", value: '//android.widget.TextView[starts-with(@text,"0x")]' },
    { strategy: "xpath", value: '//android.widget.TextView[string-length(@text)=42]' },
  ] as SelectorDef[],

  // Passkey creation dialog (emulator may show this after Create Account)
  passkeyCreateButton: [
    { strategy: "xpath", value: '//android.widget.Button[contains(@text,"Use screen lock")]' },
    { strategy: "xpath", value: '//android.widget.Button[contains(@text,"Create")]' },
    { strategy: "xpath", value: '//android.widget.Button[contains(@text,"Continue")]' },
  ] as SelectorDef[],

  // Skip/dismiss any unexpected dialogs
  skipButton: [
    { strategy: "xpath", value: '//android.widget.Button[contains(@text,"Skip")]' },
    { strategy: "xpath", value: '//android.widget.Button[contains(@text,"Not now")]' },
    { strategy: "xpath", value: '//android.widget.Button[contains(@text,"Later")]' },
    { strategy: "xpath", value: '//android.widget.Button[contains(@text,"Maybe later")]' },
    { strategy: "xpath", value: '//android.widget.Button[contains(@text,"Close")]' },
    { strategy: "xpath", value: '//android.widget.ImageButton[contains(@content-desc,"Close")]' },
  ] as SelectorDef[],
};

/** Build selectors for a specific PIN digit button (numpad fallback) */
function pinDigitSelectors(digit: string): SelectorDef[] {
  return [
    { strategy: "xpath", value: `//android.widget.Button[@text="${digit}"]` },
    { strategy: "xpath", value: `//android.widget.TextView[@text="${digit}"]` },
  ];
}

export class WalletCreator {
  private driver: AppiumDriver;
  private config: CreateWalletConfig;

  constructor(driver: AppiumDriver, config: CreateWalletConfig) {
    this.driver = driver;
    this.config = config;
  }

  // ============================================================
  // Core lifecycle
  // ============================================================

  async launch(): Promise<void> {
    logger.info("Launching Base App...");
    await this.driver.launchApp(this.config.baseApp.packageName);
    await randomDelay(3000, 5000);
    logger.info("Base App launched");
  }

  async resetApp(): Promise<void> {
    logger.info("Resetting Base App (clearing data)...");
    try {
      adbClearAppData(
        this.config.baseApp.packageName,
        this.config.appium.deviceName
      );
    } catch (err) {
      logger.warn(`Failed to clear app data (may not exist yet): ${err}`);
    }
    await randomDelay(2000, 3000);
    logger.info("Base App data cleared");
  }

  // ============================================================
  // Debug helpers
  // ============================================================

  /**
   * Dump current screen XML for debugging.
   * Saves to debug/flow_{label}_{timestamp}.xml
   */
  async dumpCurrentScreen(label: string): Promise<string> {
    try {
      if (!fs.existsSync(DEBUG_DIR)) {
        fs.mkdirSync(DEBUG_DIR, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const fileName = `flow_${label}_${timestamp}.xml`;
      const filePath = path.join(DEBUG_DIR, fileName);

      const source = await this.driver.getPageSource();
      fs.writeFileSync(filePath, source, "utf-8");
      logger.info(`Screen dump: ${filePath}`);
      return filePath;
    } catch (err) {
      logger.warn(`Failed to dump screen "${label}": ${err}`);
      return "";
    }
  }

  // ============================================================
  // Permission dialog
  // ============================================================

  /**
   * Dismiss Android permission dialog if it appears.
   * Polls for up to 5s — non-blocking if dialog is not shown.
   */
  async dismissPermissionDialog(): Promise<void> {
    logger.info("Checking for permission dialog...");

    const maxWait = 5000;
    const pollInterval = 1000;
    let elapsed = 0;

    while (elapsed < maxWait) {
      const allowBtn = await this.driver.findByMultipleSelectors(
        SELECTORS.permissionAllowButton
      );

      if (allowBtn) {
        logger.info("Permission dialog found — clicking Allow");
        await this.driver.click(allowBtn);
        await randomDelay(1000, 2000);

        // Check if another permission dialog appeared
        const anotherBtn = await this.driver.findByMultipleSelectors(
          SELECTORS.permissionAllowButton
        );
        if (anotherBtn) {
          logger.info("Another permission dialog — clicking Allow again");
          await this.driver.click(anotherBtn);
          await randomDelay(500, 1000);
        }
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      elapsed += pollInterval;
    }

    logger.info("No permission dialog detected, continuing...");
  }

  // ============================================================
  // Main flow: createWallet()
  // Complete self-contained flow per spec.
  // Throws on error so withRetry() in index.ts can retry.
  // ============================================================

  /**
   * Complete wallet creation flow:
   *  1. resetApp        2. wait 3-5s
   *  3. launch          4. wait 3-5s
   *  5. dismissPermission  6. wait 2-3s
   *  7. dump(welcome)
   *  8. clickCreate     9. wait 2-3s
   * 10. dump(after_create)
   * 11. handlePasskeyOrPin  12. wait 3-5s
   * 13. dump(after_pin)
   * 14. readWallet
   * 15. dump(wallet_home)
   * 16. screenshot
   * 17. return WalletData
   */
  async createWallet(index: number): Promise<WalletData> {
    const pin = generatePin(index, this.config.basePin);
    logger.info(`=== Creating wallet #${index}, PIN: ${pin} ===`);

    try {
      // Step 1-2: Reset app data
      await this.resetApp();
      await randomDelay(3000, 5000);

      // Step 3-4: Launch app fresh
      await this.launch();
      await randomDelay(3000, 5000);

      // Step 5-6: Dismiss permission dialog if shown
      await this.dismissPermissionDialog();
      await randomDelay(2000, 3000);

      // Step 7: Dump welcome screen
      await this.dumpCurrentScreen(`welcome_${index}`);

      // Step 8-9: Click "Create Account"
      await this.clickCreateNewWallet();
      await randomDelay(2000, 3000);

      // Step 10: Dump after create
      await this.dumpCurrentScreen(`after_create_${index}`);

      // Step 11-12: Handle passkey dialog + enter PIN
      await this.handlePasskeyOrPin(pin);
      await randomDelay(3000, 5000);

      // Step 13: Dump after PIN
      await this.dumpCurrentScreen(`after_pin_${index}`);

      // Dismiss any post-creation dialogs
      await this.dismissDialogs();
      await randomDelay(1000, 2000);

      // Wait for wallet home screen
      await this.waitForWalletCreation();

      // Step 14: Read wallet info
      const walletName = await this.readWalletName();
      const walletAddress = await this.readWalletAddress();

      // Step 15: Dump wallet home
      await this.dumpCurrentScreen(`wallet_home_${index}`);

      // Step 16: Capture screenshot
      await this.captureWalletInfo(index);

      // Step 17: Return result
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
      // Dump screen + screenshot on error for debugging, then re-throw
      await this.dumpCurrentScreen(`error_${index}`);
      await takeDebugScreenshot(this.driver, `wallet_${index}_error`);
      throw err;
    }
  }

  // ============================================================
  // Sub-steps
  // ============================================================

  async clickCreateNewWallet(): Promise<void> {
    logger.info("Looking for 'Create Account' button...");

    const btn = await this.driver.findByMultipleSelectors(
      SELECTORS.createNewWalletButton
    );

    if (!btn) {
      await takeDebugScreenshot(this.driver, "no_create_account_btn");
      throw new Error("'Create Account' button not found on welcome screen");
    }

    await this.driver.click(btn);
    logger.info("Clicked 'Create Account'");
  }

  /**
   * Handle passkey dialog (if shown) then enter PIN.
   * After clicking "Create Account", app may show passkey setup first.
   */
  async handlePasskeyOrPin(pin: string): Promise<void> {
    logger.info("Handling passkey/PIN flow...");

    // Check if passkey dialog appeared
    const passkeyBtn = await this.driver.findByMultipleSelectors(
      SELECTORS.passkeyCreateButton
    );

    if (passkeyBtn) {
      logger.info("Passkey dialog detected, clicking through...");
      await this.driver.click(passkeyBtn);
      await randomDelay(2000, 3000);

      // May show another dialog after passkey
      await this.dismissDialogs();
      await randomDelay(1000, 2000);
    }

    // Now enter PIN
    await this.enterPin(pin);
    await randomDelay(1000, 2000);

    // Confirm PIN if app asks to re-enter
    await this.confirmPin(pin);
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

    const continueBtn = await this.driver.findByMultipleSelectors(
      SELECTORS.pinContinue
    );
    if (continueBtn) {
      await this.driver.click(continueBtn);
    }
  }

  async confirmPin(pin: string): Promise<void> {
    logger.info("Checking for PIN confirmation screen...");
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

    // Check numpad
    const digitBtn = await this.driver.findByMultipleSelectors(
      pinDigitSelectors("0")
    );

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
      const nameEl = await this.driver.findByMultipleSelectors(
        SELECTORS.walletName
      );
      if (nameEl) {
        logger.info("Wallet creation completed — home screen detected");
        return;
      }

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

  private async dismissDialogs(): Promise<void> {
    const skipBtn = await this.driver.findByMultipleSelectors(
      SELECTORS.skipButton
    );
    if (skipBtn) {
      logger.info("Dismissing dialog (Skip/Not now/Close)...");
      await this.driver.click(skipBtn);
      await randomDelay(500, 1000);
    }
  }

  private async tapPinDigits(pin: string): Promise<void> {
    for (const digit of pin) {
      const btn = await this.driver.findByMultipleSelectors(
        pinDigitSelectors(digit)
      );
      if (!btn) {
        throw new Error(`Digit button '${digit}' not found on screen`);
      }
      await this.driver.click(btn);
      await randomDelay(100, 300);
    }
  }
}
