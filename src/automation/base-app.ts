import { AppiumDriver, SelectorDef } from "./appium-driver";
import { AppConfig } from "../core/config";
import { logger } from "../utils/logger";
import { randomDelay, humanType } from "../utils/delay";
import { takeDebugScreenshot } from "./screenshot";

// ============================================================
// SELECTORS — Must be verified with Appium Inspector on live app.
// Use the "scan" command to discover actual selectors.
// ============================================================

const SELECTORS = {
  // Sign In / Welcome screen
  signInButton: [
    { strategy: "xpath", value: '//android.widget.Button[@text="Sign in"]' },
    { strategy: "xpath", value: '//android.widget.Button[@text="Sign In"]' },
    { strategy: "xpath", value: '//android.widget.Button[contains(@text,"Sign")]' },
    { strategy: "accessibility id", value: "Sign in" },
  ] as SelectorDef[],

  // Email input field
  emailInput: [
    { strategy: "xpath", value: '//android.widget.EditText[contains(@hint,"email") or contains(@hint,"Email")]' },
    { strategy: "xpath", value: '//android.widget.EditText[@resource-id="email"]' },
    { strategy: "xpath", value: "(//android.widget.EditText)[1]" },
    { strategy: "-android uiautomator", value: 'new UiSelector().className("android.widget.EditText").instance(0)' },
  ] as SelectorDef[],

  // Password input field
  passwordInput: [
    { strategy: "xpath", value: '//android.widget.EditText[contains(@hint,"password") or contains(@hint,"Password")]' },
    { strategy: "xpath", value: '//android.widget.EditText[@resource-id="password"]' },
    { strategy: "xpath", value: "(//android.widget.EditText)[2]" },
    { strategy: "-android uiautomator", value: 'new UiSelector().className("android.widget.EditText").instance(1)' },
  ] as SelectorDef[],

  // Submit / Continue button after entering credentials
  submitButton: [
    { strategy: "xpath", value: '//android.widget.Button[@text="Continue"]' },
    { strategy: "xpath", value: '//android.widget.Button[@text="Submit"]' },
    { strategy: "xpath", value: '//android.widget.Button[@text="Log in"]' },
    { strategy: "xpath", value: '//android.widget.Button[@text="Next"]' },
  ] as SelectorDef[],

  // Home screen indicator (to verify logged-in state)
  homeIndicator: [
    { strategy: "xpath", value: '//android.widget.TextView[@text="Home"]' },
    { strategy: "xpath", value: '//android.widget.TextView[@text="Wallet"]' },
    { strategy: "xpath", value: '//android.view.View[@content-desc="Home"]' },
    { strategy: "accessibility id", value: "Home" },
  ] as SelectorDef[],

  // Settings / Profile for logout
  settingsButton: [
    { strategy: "xpath", value: '//android.widget.ImageView[@content-desc="Settings"]' },
    { strategy: "accessibility id", value: "Settings" },
    { strategy: "xpath", value: '//android.widget.TextView[@text="Settings"]' },
  ] as SelectorDef[],

  // Sign Out button in settings
  signOutButton: [
    { strategy: "xpath", value: '//android.widget.Button[@text="Sign out"]' },
    { strategy: "xpath", value: '//android.widget.TextView[@text="Sign out"]' },
    { strategy: "xpath", value: '//android.widget.Button[@text="Sign Out"]' },
  ] as SelectorDef[],

  // Sign Out confirmation
  confirmSignOut: [
    { strategy: "xpath", value: '//android.widget.Button[@text="Sign out"]' },
    { strategy: "xpath", value: '//android.widget.Button[@text="Confirm"]' },
    { strategy: "xpath", value: '//android.widget.Button[@text="Yes"]' },
  ] as SelectorDef[],

  // Wallet address on home screen
  walletAddress: [
    { strategy: "xpath", value: '//android.widget.TextView[contains(@text,"0x")]' },
    { strategy: "xpath", value: '//android.widget.TextView[string-length(@text)=42 and starts-with(@text,"0x")]' },
  ] as SelectorDef[],

  // "Open in Base" button when a link opens in browser first
  openInBaseAppButton: [
    { strategy: "xpath", value: '//android.widget.Button[contains(@text,"Open in")]' },
    { strategy: "xpath", value: '//android.widget.Button[contains(@text,"Open")]' },
    { strategy: "xpath", value: '//android.widget.Button[contains(@text,"Base")]' },
  ] as SelectorDef[],

  // Android intent chooser / "Open with" dialog
  intentChooser: [
    { strategy: "xpath", value: '//android.widget.TextView[@text="Open with"]' },
    { strategy: "xpath", value: '//android.widget.TextView[contains(@text,"Coinbase")]' },
    { strategy: "xpath", value: '//android.widget.TextView[contains(@text,"Base")]' },
  ] as SelectorDef[],
};

export class BaseAppController {
  private driver: AppiumDriver;
  private config: AppConfig;

  constructor(driver: AppiumDriver, config: AppConfig) {
    this.driver = driver;
    this.config = config;
  }

  async launch(): Promise<void> {
    logger.info("Launching Base App...");
    await this.driver.launchApp(this.config.baseApp.packageName);
    await randomDelay(3000, 5000);
    logger.info("Base App launched");
  }

  async login(email: string, password: string): Promise<boolean> {
    logger.info(`Logging in with: ${email}`);

    try {
      // Check if already logged in
      if (await this.isLoggedIn()) {
        logger.info("Already logged in");
        return true;
      }

      // Find and click Sign In button
      const signInBtn = await this.driver.findByMultipleSelectors(
        SELECTORS.signInButton
      );
      if (!signInBtn) {
        logger.error("Sign In button not found");
        await takeDebugScreenshot(this.driver, "login_no_signin_btn");
        return false;
      }
      await this.driver.click(signInBtn);
      await randomDelay(
        this.config.timing.actionDelay.min,
        this.config.timing.actionDelay.max
      );

      // Enter email
      const emailField = await this.driver.findByMultipleSelectors(
        SELECTORS.emailInput
      );
      if (!emailField) {
        logger.error("Email input not found");
        await takeDebugScreenshot(this.driver, "login_no_email_field");
        return false;
      }
      await this.driver.click(emailField);
      await humanType(
        async (char: string) => this.driver.sendKeys(emailField, char),
        email
      );
      await randomDelay(500, 1000);

      // Try to find a submit/next button after email, or proceed to password
      const emailSubmit = await this.driver.findByMultipleSelectors(
        SELECTORS.submitButton
      );
      if (emailSubmit) {
        await this.driver.click(emailSubmit);
        await randomDelay(
          this.config.timing.actionDelay.min,
          this.config.timing.actionDelay.max
        );
      }

      // Enter password
      const passwordField = await this.driver.findByMultipleSelectors(
        SELECTORS.passwordInput
      );
      if (!passwordField) {
        logger.error("Password input not found");
        await takeDebugScreenshot(this.driver, "login_no_password_field");
        return false;
      }
      await this.driver.click(passwordField);
      await humanType(
        async (char: string) => this.driver.sendKeys(passwordField, char),
        password
      );
      await randomDelay(500, 1000);

      // Click submit
      const submitBtn = await this.driver.findByMultipleSelectors(
        SELECTORS.submitButton
      );
      if (submitBtn) {
        await this.driver.click(submitBtn);
      }

      // Wait for login to complete
      await randomDelay(5000, 8000);

      // Verify login success
      const loggedIn = await this.isLoggedIn();
      if (loggedIn) {
        logger.info(`Successfully logged in as ${email}`);
      } else {
        logger.error(`Login verification failed for ${email}`);
        await takeDebugScreenshot(this.driver, "login_verification_failed");
      }
      return loggedIn;
    } catch (err) {
      logger.error(`Login error for ${email}: ${err}`);
      await takeDebugScreenshot(this.driver, "login_error");
      return false;
    }
  }

  async isLoggedIn(): Promise<boolean> {
    try {
      const homeEl = await this.driver.findByMultipleSelectors(
        SELECTORS.homeIndicator
      );
      return homeEl !== null;
    } catch {
      return false;
    }
  }

  async logout(): Promise<void> {
    logger.info("Logging out...");

    try {
      // Navigate to settings
      const settingsBtn = await this.driver.findByMultipleSelectors(
        SELECTORS.settingsButton
      );
      if (settingsBtn) {
        await this.driver.click(settingsBtn);
        await randomDelay(2000, 3000);
      }

      // Scroll down to find Sign Out
      await this.driver.scrollDown();
      await randomDelay(1000, 2000);

      // Click Sign Out
      const signOutBtn = await this.driver.findByMultipleSelectors(
        SELECTORS.signOutButton
      );
      if (signOutBtn) {
        await this.driver.click(signOutBtn);
        await randomDelay(2000, 3000);

        // Confirm sign out
        const confirmBtn = await this.driver.findByMultipleSelectors(
          SELECTORS.confirmSignOut
        );
        if (confirmBtn) {
          await this.driver.click(confirmBtn);
          await randomDelay(3000, 5000);
        }
      }

      logger.info("Logged out successfully");
    } catch (err) {
      logger.error(`Logout error: ${err}`);
      await takeDebugScreenshot(this.driver, "logout_error");

      // Fallback: force stop and restart app
      logger.info("Fallback: force-stopping Base App");
      await this.driver.closeApp(this.config.baseApp.packageName);
      await randomDelay(2000, 3000);
    }
  }

  async openMiniAppLink(url: string): Promise<void> {
    logger.info(`Opening miniapp link: ${url}`);

    // Open the URL via ADB deeplink
    await this.driver.openDeeplink(url);
    await randomDelay(3000, 5000);

    // Case A: Page has "Open in Base App" button (opened in browser first)
    const openInBaseBtn = await this.driver.findByMultipleSelectors(
      SELECTORS.openInBaseAppButton
    );
    if (openInBaseBtn) {
      logger.info("Found 'Open in Base App' button, clicking...");
      await this.driver.click(openInBaseBtn);
      await randomDelay(3000, 5000);
    }

    // Case B: Android intent chooser shown
    const chooser = await this.driver.findByMultipleSelectors(
      SELECTORS.intentChooser
    );
    if (chooser) {
      logger.info("Intent chooser detected, selecting Base App...");
      await this.driver.click(chooser);
      await randomDelay(3000, 5000);
    }

    // Case C: Direct deeplink — should already be handled by adb intent
    // Wait for miniapp to load
    await randomDelay(3000, 5000);
    logger.info("MiniApp link opened");
  }

  async goHome(): Promise<void> {
    logger.info("Navigating to home screen...");
    await this.driver.pressBack();
    await randomDelay(1000, 2000);

    const isHome = await this.isLoggedIn();
    if (!isHome) {
      // Try launching the app directly
      await this.launch();
    }
  }

  async getWalletAddress(): Promise<string> {
    try {
      const addressEl = await this.driver.findByMultipleSelectors(
        SELECTORS.walletAddress
      );
      if (addressEl) {
        const text = await addressEl.getText();
        if (text && text.startsWith("0x")) {
          return text;
        }
      }
      logger.warn("Could not find wallet address on screen");
      return "";
    } catch (err) {
      logger.error(`Error getting wallet address: ${err}`);
      return "";
    }
  }
}
