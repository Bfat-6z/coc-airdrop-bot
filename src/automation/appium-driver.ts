import { remote, Browser } from "webdriverio";
import { CreateWalletConfig } from "../core/config";
import { logger } from "../utils/logger";
import { adbOpenUrl } from "./adb-helpers";
import { spawn, ChildProcess } from "child_process";
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
  private appiumProcess: ChildProcess | null = null;

  constructor(config: CreateWalletConfig) {
    this.config = config;
  }

  /**
   * Start Appium server as a child process.
   * Waits for "listener started on" or the configured port in stdout.
   * Timeout 30s if Appium fails to start.
   */
  async startAppiumServer(): Promise<void> {
    // Check if Appium is already running on the configured port
    if (await this.isAppiumRunning()) {
      logger.info(
        `Appium server already running on port ${this.config.appium.port}`
      );
      return;
    }

    logger.info("Starting Appium server...");

    const port = this.config.appium.port;
    const isWindows = process.platform === "win32";

    const appiumProc = spawn(
      isWindows ? "npx.cmd" : "npx",
      ["appium", "--port", String(port), "--address", "0.0.0.0"],
      {
        shell: true,
        detached: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          ANDROID_HOME:
            process.env.ANDROID_HOME || (isWindows ? "E:\\Android" : ""),
        },
      }
    );

    this.appiumProcess = appiumProc;

    // Collect stderr for error reporting
    let stderrChunks = "";
    appiumProc.stderr?.on("data", (data: Buffer) => {
      const text = data.toString();
      stderrChunks += text;
      logger.debug(`Appium stderr: ${text.trim()}`);
    });

    // Wait for Appium to be ready
    const readyPattern = new RegExp(
      `listener started on|0\\.0\\.0\\.0:${port}|localhost:${port}`
    );

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `Appium server failed to start within 30s. stderr: ${stderrChunks.slice(-500)}`
          )
        );
      }, 30000);

      const cleanup = () => {
        clearTimeout(timeout);
        appiumProc.stdout?.removeAllListeners("data");
        appiumProc.removeAllListeners("error");
        appiumProc.removeAllListeners("exit");
      };

      appiumProc.stdout?.on("data", (data: Buffer) => {
        const text = data.toString();
        logger.debug(`Appium stdout: ${text.trim()}`);
        if (readyPattern.test(text)) {
          cleanup();
          logger.info(
            `Appium server started on port ${port} (pid: ${appiumProc.pid})`
          );
          resolve();
        }
      });

      appiumProc.on("error", (err) => {
        cleanup();
        reject(new Error(`Failed to spawn Appium process: ${err.message}`));
      });

      appiumProc.on("exit", (code) => {
        cleanup();
        reject(
          new Error(
            `Appium process exited with code ${code} before becoming ready. stderr: ${stderrChunks.slice(-500)}`
          )
        );
      });
    });
  }

  private async isAppiumRunning(): Promise<boolean> {
    try {
      const res = await fetch(
        `http://${this.config.appium.host}:${this.config.appium.port}/status`
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  async initialize(): Promise<void> {
    // Start Appium server if not already running
    await this.startAppiumServer();

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

    if (this.appiumProcess && !this.appiumProcess.killed) {
      logger.info("Stopping Appium server...");
      try {
        const pid = this.appiumProcess.pid;
        if (pid) {
          if (process.platform === "win32") {
            // Windows: kill entire process tree
            spawn("taskkill", ["/pid", String(pid), "/f", "/t"]);
          } else {
            this.appiumProcess.kill("SIGTERM");
          }
        }
      } catch (err) {
        logger.warn(`Error stopping Appium server: ${err}`);
      }
      this.appiumProcess = null;
      logger.info("Appium server stopped");
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
