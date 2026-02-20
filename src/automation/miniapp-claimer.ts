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
