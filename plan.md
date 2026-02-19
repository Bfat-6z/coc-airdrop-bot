# COC-AIRDROP-BOT — Technical Plan

## Overview

CLI automation tool (TypeScript, no UI) that:
1. Manages multiple Base App accounts on Android Emulator
2. Opens Clash of Coins miniapp deeplinks inside Base App
3. Automatically claims airdrops
4. Tracks everything in Excel

Target: https://clashofcoins.com/agentic
Platform: Base App (Coinbase Wallet rebranded) — Android
MiniApp type: Base Mini-App using MiniKit SDK

---

## Architecture

```
CLI (Node.js)
  │
  ├── Account Manager ──→ Excel (read/write wallet data)
  │
  ├── Appium Driver ──→ Android Emulator
  │       │
  │       ├── Base App automation (login, navigate)
  │       │
  │       └── MiniApp automation (open link, claim)
  │
  └── Logger + Screenshot (debug)
```

---

## Technical Stack

- Runtime: Node.js 18+
- Language: TypeScript 5+
- Mobile Automation: WebdriverIO 9 + Appium 2 + UiAutomator2
- Excel: exceljs
- Logging: winston
- Config: dotenv

### package.json dependencies

```json
{
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
  }
}
```

---

## Module Specifications

### 1. `src/core/config.ts`

Types and configuration loader.

```typescript
// Types needed:
interface AccountData {
  id: number;
  email: string;
  password: string;           // Base App password
  walletAddress: string;      // Auto-assigned by Base App
  recoveryPhrase: string;     // If available
  claimStatus: "pending" | "claimed" | "failed" | "skipped";
  claimLink: string;
  lastAttempt: string;        // ISO timestamp
  errorMessage?: string;
}

interface AppConfig {
  excelFilePath: string;          // ./data/accounts.xlsx
  claimLinksSheet: string;        // "Links"
  accountsSheet: string;          // "Accounts"
  appium: {
    host: string;                 // localhost
    port: number;                 // 4723
    deviceName: string;           // emulator-5554
  };
  baseApp: {
    packageName: string;          // org.toshi (Coinbase Wallet / Base App)
    activityName: string;         // Main activity
  };
  timing: {
    elementTimeout: number;       // 15000ms
    actionDelay: number;          // 2000-5000ms (randomized)
    betweenAccounts: number;      // 10000-30000ms (randomized)
    maxRetries: number;           // 3
  };
}
```

### 2. `src/core/wallet-store.ts`

Excel read/write operations using exceljs.

Functions needed:
- `loadAccounts(): Promise<AccountData[]>` — Read accounts from "Accounts" sheet
- `saveAccounts(accounts: AccountData[]): Promise<void>` — Write/overwrite accounts
- `updateAccountStatus(id: number, status, errorMsg?): Promise<void>` — Update single row
- `loadClaimLinks(): Promise<string[]>` — Read links from "Links" sheet
- `exportReport(): Promise<void>` — Generate summary (total, claimed, failed)

Excel structure for "Accounts" sheet:
| # | Email | Password | Wallet Address | Recovery Phrase | Claim Status | Claim Link | Last Attempt | Error |
Column widths: auto-fit. Header row: bold, blue background.

Excel structure for "Links" sheet:
| Claim Link | Description (optional) |

### 3. `src/core/account-manager.ts`

Account lifecycle management. This module does NOT create accounts automatically
(Base App requires email verification, possibly phone/KYC).

Instead, it manages pre-created accounts:
- `loadPendingAccounts(): Promise<AccountData[]>` — Get accounts with status "pending"
- `assignLinksToAccounts(accounts, links): void` — Map links to accounts 1:1
- `getNextAccount(): Promise<AccountData | null>` — Iterator for processing

IMPORTANT NOTE: Users must manually create Base App accounts beforehand and
fill in the Excel "Accounts" sheet with email + password. The tool then
automates the login → claim flow.

### 4. `src/automation/appium-driver.ts`

Manages Appium WebDriver session lifecycle.

```typescript
class AppiumDriver {
  private driver: Browser | null;

  // Initialize Appium session targeting Base App (not browser)
  async initialize(): Promise<void> {
    // Capabilities:
    // platformName: "Android"
    // appium:automationName: "UiAutomator2"
    // appium:deviceName: from config
    // appium:appPackage: "org.toshi"  (Coinbase Wallet / Base App package)
    // appium:appActivity: main launcher activity
    // appium:noReset: true (keep app data between sessions)
    // appium:newCommandTimeout: 300
    // appium:autoGrantPermissions: true
  }

  // Core element interaction methods
  async findElement(strategy: string, selector: string, timeout?: number): Promise<Element>;
  async findElements(strategy: string, selector: string): Promise<Element[]>;
  async click(element: Element): Promise<void>;
  async sendKeys(element: Element, text: string): Promise<void>;
  async waitForElement(strategy: string, selector: string, timeout: number): Promise<Element>;

  // Try multiple selectors, return first match
  async findByMultipleSelectors(selectors: SelectorDef[]): Promise<Element | null>;

  // Navigation
  async pressBack(): Promise<void>;
  async pressHome(): Promise<void>;
  async openDeeplink(url: string): Promise<void>;
  // Use: adb shell am start -a android.intent.action.VIEW -d "URL"

  // Gestures
  async scrollDown(): Promise<void>;
  async scrollUp(): Promise<void>;
  async swipeLeft(): Promise<void>;

  // Utils
  async takeScreenshot(name: string): Promise<string>; // returns file path
  async getPageSource(): Promise<string>;
  async isAppInstalled(packageName: string): Promise<boolean>;
  async launchApp(packageName: string): Promise<void>;
  async closeApp(packageName: string): Promise<void>;

  async cleanup(): Promise<void>;
}

type SelectorDef = {
  strategy: "xpath" | "id" | "accessibility id" | "class name" | "-android uiautomator";
  value: string;
};
```

### 5. `src/automation/base-app.ts`

Controls Base App (Coinbase Wallet / org.toshi) on emulator.

```typescript
class BaseAppController {
  constructor(private driver: AppiumDriver) {}

  // Launch Base App
  async launch(): Promise<void>;

  // Login with email + password
  // Flow: Open app → tap "Sign In" → enter email → enter password → handle 2FA if needed
  async login(email: string, password: string): Promise<boolean>;

  // Check if already logged in
  async isLoggedIn(): Promise<boolean>;

  // Logout current account (to switch accounts)
  async logout(): Promise<void>;

  // Open a URL that deep-links into Base App
  // Method: Use adb to open URL → Android resolves to Base App
  //   adb shell am start -a android.intent.action.VIEW -d "https://clashofcoins.com/agentic"
  // Base App should intercept this and open the miniapp
  async openMiniAppLink(url: string): Promise<void>;

  // Navigate to wallet/home screen
  async goHome(): Promise<void>;

  // Get current wallet address displayed in app
  async getWalletAddress(): Promise<string>;
}
```

CRITICAL IMPLEMENTATION NOTES for openMiniAppLink:
- The link https://clashofcoins.com/agentic on mobile opens in browser first
- Then there should be a button/link that deep-links into Base App
- OR the page auto-redirects via deeplink (cbwallet:// scheme)
- Need to handle both cases:
  Case A: Page has "Open in Base App" button → find & click it
  Case B: Page auto-redirects → handle Android intent chooser if shown
  Case C: Direct deeplink → adb shell am start with cbwallet:// URI

The SELECTORS for Base App UI elements need to be discovered by:
1. Running `appium inspector` while Base App is open
2. Using `adb shell uiautomator dump` to get UI XML
3. Testing on actual emulator with Base App installed

PLACEHOLDER SELECTORS (must be verified):
- Sign In button: `//android.widget.Button[@text="Sign In"]` or resource-id
- Email input: `//android.widget.EditText[@hint contains "email"]`
- Password input: `//android.widget.EditText[@hint contains "password"]`
- Home tab: resource-id for bottom navigation
- Wallet address: text element on main screen

### 6. `src/automation/miniapp-claimer.ts`

Controls the Clash of Coins miniapp INSIDE Base App.

```typescript
class MiniAppClaimer {
  constructor(private driver: AppiumDriver) {}

  // After miniapp loads inside Base App, interact with it
  // MiniApps in Base App render as WebViews, so we may need to:
  //   1. Switch to WEBVIEW context (driver.getContexts() → switch)
  //   2. Then use web selectors (CSS/XPath on HTML)
  //   OR
  //   1. Stay in NATIVE context if UI elements are accessible

  // Wait for miniapp to fully load
  async waitForMiniAppLoad(): Promise<boolean>;

  // The main claim flow inside Clash of Coins agentic page:
  // 1. Page loads → may show "Join Tournament" or "Sign Up" or "Claim"
  // 2. Click the appropriate CTA button
  // 3. May need to confirm wallet transaction
  // 4. Verify claim success
  async performClaim(): Promise<ClaimResult>;

  // Handle different states the miniapp could be in
  async detectCurrentState(): Promise<MiniAppState>;
  // States: "loading" | "signup" | "claim_available" | "already_claimed" | "error"

  // Click claim/join button
  async clickClaimButton(): Promise<boolean>;

  // Handle transaction confirmation popup from Base App
  async confirmTransaction(): Promise<boolean>;

  // Check if claim was successful
  async verifyClaimSuccess(): Promise<boolean>;
}

type ClaimResult = {
  success: boolean;
  state: MiniAppState;
  error?: string;
  screenshotPath?: string;
};

type MiniAppState = "loading" | "signup" | "claim_available" | "already_claimed" | "error" | "unknown";
```

CRITICAL: MiniApp runs in a WebView inside Base App.
To interact with WebView content:
```typescript
// Get available contexts
const contexts = await driver.getContexts();
// Usually: ["NATIVE_APP", "WEBVIEW_org.toshi"]

// Switch to WebView to use CSS/XPath on HTML
await driver.switchContext("WEBVIEW_org.toshi");

// Now can use web selectors
const claimBtn = await driver.findElement("css selector", "button.claim-btn");

// Switch back to native when needed (e.g., for wallet confirmation popup)
await driver.switchContext("NATIVE_APP");
```

SELECTORS TO DISCOVER (need Appium Inspector on live app):
- Clash of Coins claim/join button
- Tournament signup form (if any)
- Transaction confirm button (native Base App popup)
- Success/failure indicators

### 7. `src/automation/adb-helpers.ts`

Direct ADB commands as fallback/helper.

```typescript
// All functions use child_process.execSync

// Open URL via Android intent (triggers deeplink)
function adbOpenUrl(url: string, deviceId?: string): void;
// cmd: adb [-s deviceId] shell am start -a android.intent.action.VIEW -d "url"

// Tap at coordinates
function adbTap(x: number, y: number, deviceId?: string): void;
// cmd: adb shell input tap x y

// Type text
function adbType(text: string, deviceId?: string): void;
// cmd: adb shell input text "text"

// Press key
function adbKey(keycode: number, deviceId?: string): void;
// cmd: adb shell input keyevent keycode
// Common: 4=BACK, 3=HOME, 66=ENTER

// Screenshot
function adbScreenshot(savePath: string, deviceId?: string): void;
// cmd: adb shell screencap /sdcard/tmp.png && adb pull /sdcard/tmp.png savePath

// Get UI XML dump (for finding elements)
function adbDumpUI(savePath: string, deviceId?: string): void;
// cmd: adb shell uiautomator dump /sdcard/ui.xml && adb pull /sdcard/ui.xml savePath

// Check if app is running
function adbIsAppRunning(packageName: string, deviceId?: string): boolean;

// Force stop app
function adbForceStop(packageName: string, deviceId?: string): void;

// Clear app data (full reset)
function adbClearAppData(packageName: string, deviceId?: string): void;

// List connected devices
function adbDevices(): string[];

// Install APK
function adbInstall(apkPath: string, deviceId?: string): void;
```

### 8. `src/utils/retry.ts`

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries: number;
    delayMs: number;           // Base delay
    backoffMultiplier?: number; // Default 2 (exponential)
    onRetry?: (attempt: number, error: Error) => void;
  }
): Promise<T>;
```

### 9. `src/utils/delay.ts`

```typescript
// Random delay between min and max (anti-detection)
async function randomDelay(minMs: number, maxMs: number): Promise<void>;

// Human-like typing delay
async function humanType(driver: AppiumDriver, element: Element, text: string): Promise<void>;
// Types each character with 50-150ms random delay
```

### 10. `src/index.ts`

CLI entry point with commands:

```
Commands:
  scan           Discover UI selectors on live emulator (debug mode)
  claim          Run claim flow for all pending accounts
  status         Show claim status summary from Excel
  reset          Reset all statuses to "pending"
  test           Test connection to emulator + Base App
```

Main claim flow pseudocode:
```
1. Load config
2. Load pending accounts from Excel
3. Load claim links from Excel
4. Assign links to accounts
5. Initialize Appium driver
6. For each account:
   a. If not first account: logout previous account
   b. Login with account credentials
   c. Verify login success
   d. Open claim link (deeplink into miniapp)
   e. Wait for miniapp load
   f. Detect state → perform claim
   g. Take screenshot
   h. Update Excel with result
   i. Random delay before next account
7. Generate summary report
8. Cleanup
```

---

## Setup Prerequisites (User must do manually)

### 1. Install Android Studio + Create Emulator
- Android Studio: https://developer.android.com/studio
- Create AVD: Pixel 6, API 34 (Android 14), Google Play variant
- Start emulator

### 2. Install Base App on Emulator
```bash
# Option A: Install from Google Play Store on emulator
# Open Play Store → search "Coinbase Wallet" (now Base App) → Install

# Option B: Sideload APK
# Download APK from apkpure/apkmirror
# adb install base-app.apk
```

### 3. Install Appium
```bash
npm install -g appium
appium driver install uiautomator2
```

### 4. Create Base App Accounts (Manual)
- Each account needs unique email
- Register on Base App
- Fill account details into Excel "Accounts" sheet

### 5. Prepare Claim Links
- Add links to Excel "Links" sheet
- One link per row in column A

---

## Selector Discovery Phase

BEFORE the automation can work, selectors must be discovered.

### Method 1: Appium Inspector
```bash
# Start Appium server
appium

# Open Appium Inspector (GUI)
# Connect to running session
# Navigate through Base App → click elements → copy selectors
```

### Method 2: ADB UI Dump
```bash
# Get XML dump of current screen
adb shell uiautomator dump /sdcard/ui.xml
adb pull /sdcard/ui.xml ./debug/
# Open XML → find resource-id, text, class for each element
```

### Method 3: Chrome DevTools (for WebView/MiniApp)
```bash
# On desktop Chrome, go to:
chrome://inspect/#devices
# Find "WebView in org.toshi" → click Inspect
# Now can see HTML/CSS of miniapp → find selectors
```

The tool should include a `scan` command that helps with this:
```bash
npm run start scan
# → Opens Base App
# → Dumps UI XML
# → Takes screenshot
# → If WebView detected, lists available contexts
# → Saves all to ./debug/ folder
```

---

## Risk Mitigation

### Anti-Detection
- Random delays between actions (2-5 seconds)
- Random delay between accounts (10-30 seconds)
- Human-like typing speed
- Don't run too many accounts per session (batch of 5-10, then rest)

### Error Recovery
- Screenshot on every error
- Retry failed steps up to 3 times
- If account fails, mark as "failed" with error message, continue to next
- If Appium crashes, reconnect and resume from last pending account

### Data Safety
- Excel file is single source of truth
- Status updated immediately after each claim attempt
- Can resume from where it stopped (only processes "pending" accounts)

---

## Environment Variables (.env)

```
EXCEL_FILE_PATH=./data/accounts.xlsx
ACCOUNTS_SHEET=Accounts
LINKS_SHEET=Links

APPIUM_HOST=localhost
APPIUM_PORT=4723
ANDROID_DEVICE_NAME=emulator-5554

BASE_APP_PACKAGE=org.toshi
BASE_APP_ACTIVITY=.MainActivity

ELEMENT_TIMEOUT=15000
ACTION_DELAY_MIN=2000
ACTION_DELAY_MAX=5000
BETWEEN_ACCOUNTS_MIN=10000
BETWEEN_ACCOUNTS_MAX=30000
MAX_RETRIES=3

LOG_LEVEL=info
```

---

## Implementation Order

Phase 1 (Foundation):
  1. config.ts — types + config loader
  2. logger.ts — winston setup
  3. delay.ts + retry.ts — utilities
  4. wallet-store.ts — Excel operations
  5. adb-helpers.ts — ADB wrapper functions

Phase 2 (Appium Core):
  6. appium-driver.ts — session management + element helpers
  7. screenshot.ts — debug screenshots

Phase 3 (Base App Control):
  8. base-app.ts — login/logout/navigate
  9. Selector discovery (manual step with scan command)

Phase 4 (MiniApp Claim):
  10. miniapp-claimer.ts — claim logic
  11. Selector discovery for miniapp WebView (manual step)

Phase 5 (Orchestration):
  12. account-manager.ts — account lifecycle
  13. index.ts — CLI + main flow

Phase 6 (Polish):
  14. Error handling improvements
  15. Resume capability
  16. Summary report generation
