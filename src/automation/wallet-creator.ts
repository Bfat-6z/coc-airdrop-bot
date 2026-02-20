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
