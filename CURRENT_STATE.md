# CURRENT_STATE.md — Codebase Audit

Generated: 2026-02-20

---

## 1. File Inventory

### Project Config Files

| File | Purpose | Status |
|------|---------|--------|
| `package.json` | NPM config: name, scripts, deps | Complete |
| `tsconfig.json` | TypeScript config: ES2022, commonjs, strict | Complete |
| `.env.example` | Environment variable template (19 vars) | Complete |
| `.gitignore` | Ignores node_modules, dist, .env, *.xlsx, debug/, screenshots/ | Complete |

---

### `src/core/config.ts`

- **Purpose**: Type definitions + config loader from `.env`
- **Exports**:
  - `interface AccountData` — fields: id, email, password, walletAddress, recoveryPhrase, claimStatus (union type), claimLink, lastAttempt, errorMessage?
  - `interface AppConfig` — fields: excelFilePath, claimLinksSheet, accountsSheet, appium (host/port/deviceName), baseApp (packageName/activityName), timing (elementTimeout, actionDelay min/max, betweenAccounts min/max, maxRetries), logLevel
  - `function loadConfig(): AppConfig` — reads from `process.env` with defaults
- **Dependencies**: `dotenv`, `path`
- **Status**: **Complete** — fully functional, no placeholders

---

### `src/utils/logger.ts`

- **Purpose**: Winston logger with colorized console transport
- **Exports**:
  - `const logger` — Winston logger instance (format: `YYYY-MM-DD HH:mm:ss [level] meta: message`)
  - `function setLogLevel(level: string): void`
- **Dependencies**: `winston`
- **Status**: **Complete** — fully functional, no placeholders

---

### `src/utils/delay.ts`

- **Purpose**: Anti-detection delays and human-like typing
- **Exports**:
  - `async function randomDelay(minMs, maxMs): Promise<void>` — random sleep between min/max
  - `async function humanType(sendKeysFn, text): Promise<void>` — types each character with 50-150ms random delay
- **Dependencies**: `./logger`
- **Status**: **Complete** — fully functional. Note: `humanType` takes a `sendKeysFn` callback (not an AppiumDriver + Element pair as in plan.md — adapted for decoupling)

---

### `src/utils/retry.ts`

- **Purpose**: Generic retry with exponential backoff
- **Exports**:
  - `interface RetryOptions` — maxRetries, delayMs, backoffMultiplier?, onRetry?
  - `async function withRetry<T>(fn, options): Promise<T>` — executes fn, retries on failure with exponential delay
- **Dependencies**: `./logger`
- **Status**: **Complete** — fully functional, no placeholders

---

### `src/core/wallet-store.ts`

- **Purpose**: Excel read/write operations via exceljs
- **Exports**:
  - `class WalletStore`
    - `constructor(config: AppConfig)`
    - `async loadAccounts(): Promise<AccountData[]>` — reads "Accounts" sheet, skips header
    - `async saveAccounts(accounts: AccountData[]): Promise<void>` — recreates sheet, styled headers (bold white on blue #4472C4)
    - `async updateAccountStatus(id, status, errorMsg?): Promise<void>` — updates single row by id
    - `async loadClaimLinks(): Promise<string[]>` — reads "Links" sheet column A
    - `async exportReport(): Promise<void>` — logs summary: total/claimed/failed/pending/skipped/success rate
    - `async initializeExcel(): Promise<void>` — creates empty Excel with formatted headers if not exists
  - Constants: `ACCOUNT_COLUMNS` (9 columns), `LINK_COLUMNS` (2 columns), `HEADER_FILL`, `HEADER_FONT`
  - Private: `getWorkbook()`, `ensureDirectory()`, `styleHeaderRow()`
- **Dependencies**: `exceljs`, `path`, `fs`, `./config`, `../utils/logger`
- **Status**: **Complete** — fully functional, no placeholders

---

### `src/automation/adb-helpers.ts`

- **Purpose**: Direct ADB command wrappers via `child_process.execSync`
- **Exports**:
  - `function adbOpenUrl(url, deviceId?): void` — `adb shell am start -a android.intent.action.VIEW -d "url"`
  - `function adbTap(x, y, deviceId?): void` — `adb shell input tap x y`
  - `function adbType(text, deviceId?): void` — `adb shell input text` (escapes special chars)
  - `function adbKey(keycode, deviceId?): void` — `adb shell input keyevent`
  - `const ADB_KEYS` — BACK=4, HOME=3, ENTER=66, TAB=61, DELETE=67, MENU=82
  - `function adbScreenshot(savePath, deviceId?): void` — screencap + pull + cleanup
  - `function adbDumpUI(savePath, deviceId?): void` — uiautomator dump + pull + cleanup
  - `function adbIsAppRunning(packageName, deviceId?): boolean` — checks via `pidof`
  - `function adbForceStop(packageName, deviceId?): void`
  - `function adbClearAppData(packageName, deviceId?): void`
  - `function adbDevices(): string[]` — lists connected device IDs
  - `function adbInstall(apkPath, deviceId?): void`
- **Dependencies**: `child_process`, `../utils/logger`
- **Status**: **Complete** — fully functional, no placeholders. All commands have 30s timeout.

---

### `src/automation/appium-driver.ts`

- **Purpose**: Appium WebDriver session lifecycle + element interaction helpers
- **Exports**:
  - `type SelectorDef` — { strategy, value } for multi-selector lookup
  - `interface WdioElement` — click, setValue, getText, getAttribute, isExisting, isDisplayed, waitForExist, waitForDisplayed
  - `class AppiumDriver`
    - `constructor(config: AppConfig)`
    - `async initialize(): Promise<void>` — creates remote session with UiAutomator2 capabilities
    - `async findElement(strategy, selector, timeout?): Promise<WdioElement>`
    - `async findElements(strategy, selector): Promise<WdioElement[]>`
    - `async click(element): Promise<void>`
    - `async sendKeys(element, text): Promise<void>`
    - `async waitForElement(strategy, selector, timeout): Promise<WdioElement>`
    - `async findByMultipleSelectors(selectors: SelectorDef[]): Promise<WdioElement | null>` — tries each selector, returns first match
    - Navigation: `pressBack()`, `pressHome()`, `openDeeplink(url)` (uses adbOpenUrl)
    - Gestures: `scrollDown()`, `scrollUp()`, `swipeLeft()` (via touchAction)
    - Utils: `takeScreenshot(name)`, `getPageSource()`, `isAppInstalled(pkg)`, `launchApp(pkg)`, `closeApp(pkg)`
    - Context: `getContexts()`, `switchContext(ctx)`
    - `async cleanup(): Promise<void>` — deletes session
  - Private: `buildSelector(strategy, value): string` — maps strategy to WebdriverIO selector format
- **Dependencies**: `webdriverio`, `../core/config`, `../utils/logger`, `./adb-helpers`, `path`, `fs`
- **Status**: **Complete** — fully functional. Uses `touchAction` for gestures (deprecated in some WebdriverIO versions but functional with UiAutomator2).

---

### `src/automation/screenshot.ts`

- **Purpose**: Debug screenshot and UI hierarchy capture
- **Exports**:
  - `async function takeDebugScreenshot(driver, name): Promise<string>` — saves to `./screenshots/`, returns path (empty string on error)
  - `async function saveUIHierarchy(driver, name): Promise<string>` — saves page source XML to `./debug/`, returns path
  - `async function captureDebugInfo(driver, name): Promise<{screenshotPath, hierarchyPath}>` — calls both in parallel
- **Dependencies**: `path`, `fs`, `./appium-driver`, `../utils/logger`
- **Status**: **Complete** — fully functional, no placeholders

---

### `src/automation/base-app.ts`

- **Purpose**: Controls Base App (org.toshi / Coinbase Wallet) on emulator
- **Exports**:
  - `class BaseAppController`
    - `constructor(driver: AppiumDriver, config: AppConfig)`
    - `async launch(): Promise<void>` — activates app + waits 3-5s
    - `async login(email, password): Promise<boolean>` — full flow: check if logged in → Sign In btn → email → password → submit → verify
    - `async isLoggedIn(): Promise<boolean>` — checks for home indicator element
    - `async logout(): Promise<void>` — Settings → scroll → Sign Out → confirm. Fallback: force-stop
    - `async openMiniAppLink(url): Promise<void>` — deeplink via ADB, handles 3 cases: "Open in Base" button, intent chooser, direct deeplink
    - `async goHome(): Promise<void>` — pressBack, relaunch if needed
    - `async getWalletAddress(): Promise<string>` — finds `0x...` text element
- **Dependencies**: `./appium-driver`, `../core/config`, `../utils/logger`, `../utils/delay`, `./screenshot`
- **Status**: **Complete with placeholder selectors** — all logic is implemented, but UI selectors need verification on live emulator (see Section 2)

---

### `src/automation/miniapp-claimer.ts`

- **Purpose**: Controls the Clash of Coins miniapp inside Base App's WebView
- **Exports**:
  - `type MiniAppState` — "loading" | "signup" | "claim_available" | "already_claimed" | "error" | "unknown"
  - `type ClaimResult` — { success, state, error?, screenshotPath? }
  - `class MiniAppClaimer`
    - `constructor(driver: AppiumDriver, config: AppConfig)`
    - `async waitForMiniAppLoad(): Promise<boolean>` — polls for WEBVIEW_ context, checks state
    - `async performClaim(): Promise<ClaimResult>` — full flow: wait → detect state → act (claim/skip/fail)
    - `async detectCurrentState(): Promise<MiniAppState>` — switches to WebView, checks CSS selectors
    - `async clickClaimButton(): Promise<boolean>` — finds & clicks claim btn in WebView, switches back to native
    - `async confirmTransaction(): Promise<boolean>` — switches to NATIVE_APP, finds confirm button
    - `async verifyClaimSuccess(): Promise<boolean>` — checks WebView + native page source for success indicators
  - Private: `detectWebViewState()`, `detectNativeState()` (fallback via page source text)
- **Dependencies**: `./appium-driver`, `../core/config`, `../utils/logger`, `../utils/delay`, `./screenshot`
- **Status**: **Complete with placeholder selectors** — all logic is implemented, but CSS/native selectors need verification on live app (see Section 2)

---

### `src/core/account-manager.ts`

- **Purpose**: Account lifecycle management — loads, iterates, updates accounts
- **Exports**:
  - `class AccountManager`
    - `constructor(config: AppConfig)`
    - `async loadPendingAccounts(): Promise<AccountData[]>` — filters by claimStatus === "pending"
    - `assignLinksToAccounts(accounts, links): void` — maps 1:1, fallback to first link
    - `async getNextAccount(): Promise<AccountData | null>` — internal index-based iterator
    - `async updateStatus(accountId, status, errorMsg?): Promise<void>` — delegates to WalletStore
    - `async exportReport(): Promise<void>` — delegates to WalletStore
    - `async initializeExcel(): Promise<void>` — delegates to WalletStore
    - `getStore(): WalletStore`
    - `getPendingCount(): number`
    - `getTotalPending(): number`
- **Dependencies**: `./config`, `./wallet-store`, `../utils/logger`
- **Status**: **Complete** — fully functional, no placeholders

---

### `src/index.ts`

- **Purpose**: CLI entry point with command routing
- **Exports**: none (runs `main()` on import)
- **Functions**:
  - `async runClaim(config)` — full orchestration: load accounts → load links → assign → init Appium → for each account: logout previous → launch → login (with retry) → get wallet → open link → claim (with retry) → update status → report → cleanup
  - `async runScan(config)` — check ADB devices → init Appium → screenshot + UI hierarchy → ADB dump → list WebView contexts → save WebView HTML sources to `./debug/`
  - `async runStatus(config)` — calls `store.exportReport()`
  - `async runReset(config)` — loads all accounts, sets all to "pending", saves
  - `async runTest(config)` — tests ADB devices, Appium connection, Base App installed check, screenshot, Excel access
  - `function printUsage()` — help text
  - `async main()` — parses `process.argv[2]`, routes to command handler
- **Dependencies**: all modules (`./core/config`, `./core/account-manager`, `./core/wallet-store`, `./automation/appium-driver`, `./automation/base-app`, `./automation/miniapp-claimer`, `./automation/screenshot`, `./automation/adb-helpers`, `./utils/logger`, `./utils/delay`, `./utils/retry`)
- **Status**: **Complete** — fully functional CLI with 5 commands

---

## 2. Placeholder Selectors (Need Discovery on Live Emulator)

All selectors below are **best-guess placeholders**. They must be verified using `npm start scan` (Appium Inspector / ADB UI dump / Chrome DevTools) on a real emulator with Base App installed.

### `src/automation/base-app.ts` — SELECTORS object (lines 12-93)

| Selector Group | Purpose | Strategies Tried | Location |
|----------------|---------|-----------------|----------|
| `signInButton` | Tap "Sign In" on welcome screen | xpath(`@text="Sign in"`), xpath(`@text="Sign In"`), xpath(`contains(@text,"Sign")`), accessibility id(`Sign in`) | line 14-19 |
| `emailInput` | Email text field during login | xpath(`contains(@hint,"email")`), xpath(`@resource-id="email"`), xpath(`(//EditText)[1]`), uiautomator(`EditText.instance(0)`) | line 22-27 |
| `passwordInput` | Password text field during login | xpath(`contains(@hint,"password")`), xpath(`@resource-id="password"`), xpath(`(//EditText)[2]`), uiautomator(`EditText.instance(1)`) | line 30-35 |
| `submitButton` | Continue/Submit/Log in/Next after credentials | xpath(`@text="Continue"`), xpath(`@text="Submit"`), xpath(`@text="Log in"`), xpath(`@text="Next"`) | line 38-43 |
| `homeIndicator` | Verify logged-in state (home screen element) | xpath(`@text="Home"`), xpath(`@text="Wallet"`), xpath(`@content-desc="Home"`), accessibility id(`Home`) | line 46-51 |
| `settingsButton` | Navigate to settings for logout | xpath(`ImageView[@content-desc="Settings"]`), accessibility id(`Settings`), xpath(`@text="Settings"`) | line 54-58 |
| `signOutButton` | Sign Out button in settings | xpath(`Button[@text="Sign out"]`), xpath(`TextView[@text="Sign out"]`), xpath(`Button[@text="Sign Out"]`) | line 61-65 |
| `confirmSignOut` | Confirm logout dialog | xpath(`Button[@text="Sign out"]`), xpath(`Button[@text="Confirm"]`), xpath(`Button[@text="Yes"]`) | line 68-72 |
| `walletAddress` | 0x... address on home screen | xpath(`contains(@text,"0x")`), xpath(`string-length(@text)=42 and starts-with(@text,"0x")`) | line 75-78 |
| `openInBaseAppButton` | "Open in Base App" when link opens in browser | xpath(`contains(@text,"Open in")`), xpath(`contains(@text,"Open")`), xpath(`contains(@text,"Base")`) | line 81-85 |
| `intentChooser` | Android "Open with" dialog | xpath(`@text="Open with"`), xpath(`contains(@text,"Coinbase")`), xpath(`contains(@text,"Base")`) | line 88-92 |

### `src/automation/miniapp-claimer.ts` — NATIVE_SELECTORS (lines 28-41)

| Selector Group | Purpose | Strategies Tried | Location |
|----------------|---------|-----------------|----------|
| `confirmTransaction` | Wallet tx confirmation popup | xpath(`@text="Confirm"`), xpath(`@text="Approve"`), xpath(`@text="Sign"`), xpath(`contains(@text,"Confirm")`) | line 29-34 |
| `rejectTransaction` | Reject tx popup (not used in claim flow) | xpath(`@text="Reject"`), xpath(`@text="Cancel"`) | line 37-40 |

### `src/automation/miniapp-claimer.ts` — WEB_SELECTORS (lines 44-87)

These are **CSS selectors** for use inside the WebView context (`WEBVIEW_org.toshi`).

| Selector Group | Purpose | CSS Selectors | Location |
|----------------|---------|---------------|----------|
| `claimButton` | Main claim/join CTA button | `button.claim-btn`, `button[data-action="claim"]`, `a[href*="claim"]`, `button.btn-primary`, `button:has-text("Claim")`, `button:has-text("Join")`, `button:has-text("Start")`, `[class*='claim']`, `[class*='join']` | line 46-56 |
| `alreadyClaimed` | Success/already claimed indicator | `[class*='claimed']`, `[class*='success']`, `text*='Already claimed'`, `text*='Completed'` | line 59-64 |
| `loading` | Loading spinner detection | `[class*='loading']`, `[class*='spinner']`, `.loader` | line 67-71 |
| `error` | Error state detection | `[class*='error']`, `[class*='fail']`, `.error-message` | line 74-78 |
| `signup` | Signup/register form detection | `form[class*='signup']`, `form[class*='register']`, `button:has-text("Sign Up")`, `button:has-text("Register")` | line 81-86 |

**Note on WEB_SELECTORS**: Some CSS selectors use `:has-text()` which is a Playwright-specific pseudo-class and is **NOT valid** in standard CSS/WebDriver. These will silently fail and fall through to the next selector. They should be replaced with XPath or standard CSS once actual selectors are discovered.

---

## 3. Command Flows

### `npm start claim` — Main Claim Flow

```
1.  loadConfig() from .env
2.  setLogLevel()
3.  AccountManager.initializeExcel()     → creates data/accounts.xlsx if missing
4.  AccountManager.loadPendingAccounts() → filters claimStatus === "pending"
5.  WalletStore.loadClaimLinks()         → reads "Links" sheet
6.  AccountManager.assignLinksToAccounts() → maps links to accounts 1:1
7.  AppiumDriver.initialize()            → creates Appium session (with retry x2)
8.  FOR EACH pending account:
    a. If not first: BaseAppController.logout() + random delay (10-30s)
    b. BaseAppController.launch()         → activateApp("org.toshi")
    c. BaseAppController.login(email, pw) → with retry (x3):
       - Check isLoggedIn
       - Click Sign In → enter email (humanType) → enter password → click Submit
       - Wait 5-8s → verify isLoggedIn
    d. BaseAppController.getWalletAddress() → read 0x... from screen
    e. BaseAppController.openMiniAppLink(link) → ADB deeplink, handle 3 cases
    f. MiniAppClaimer.performClaim() → with retry (x3):
       - waitForMiniAppLoad() → poll for WEBVIEW_ context
       - detectCurrentState() → switch to WebView, check CSS selectors
       - If claim_available: clickClaimButton() → confirmTransaction() → verifyClaimSuccess()
       - If already_claimed: return success
       - If signup/error/unknown: return failure
    g. AccountManager.updateStatus() → write result to Excel immediately
    h. BaseAppController.goHome()
    i. Next account
9.  AccountManager.exportReport()        → log summary
10. AppiumDriver.cleanup()               → delete Appium session
```

**Error handling**: On any per-account error, catches exception, marks account as "failed" with error message, takes error screenshot + UI dump, continues to next account.

---

### `npm start scan` — Selector Discovery

```
1.  loadConfig()
2.  adbDevices() → check for connected emulators (exit if none)
3.  AppiumDriver.initialize()
4.  captureDebugInfo() → screenshot + UI hierarchy XML saved to ./screenshots/ and ./debug/
5.  adbDumpUI() → saves ADB UI dump to ./debug/adb_ui_dump.xml
6.  AppiumDriver.getContexts() → lists all contexts (NATIVE_APP, WEBVIEW_*)
7.  For each WEBVIEW_ context:
    a. switchContext(webview)
    b. getPageSource() → save HTML to ./debug/webview_source_<ctx>.html
    c. switchContext("NATIVE_APP")
8.  AppiumDriver.cleanup()
```

**Output files**:
- `./screenshots/scan_initial_<timestamp>.png`
- `./debug/scan_initial_<timestamp>.xml` (page source)
- `./debug/adb_ui_dump.xml` (ADB uiautomator dump)
- `./debug/webview_source_WEBVIEW_org_toshi_<timestamp>.html` (if WebView exists)

---

### `npm start status` — Claim Status Summary

```
1. loadConfig()
2. WalletStore.loadAccounts() → read all accounts
3. WalletStore.exportReport() → logs to console:
   - Total accounts
   - Claimed count
   - Failed count
   - Pending count
   - Skipped count
   - Success rate %
```

---

### `npm start reset` — Reset All Statuses

```
1. loadConfig()
2. WalletStore.loadAccounts() → read all
3. For each account: set claimStatus = "pending", clear errorMessage, clear lastAttempt
4. WalletStore.saveAccounts() → overwrite sheet
5. Log: "Reset N accounts to pending"
```

---

### `npm start test` — Connection Test

```
1. loadConfig()
2. ADB check: adbDevices() → list connected devices
3. Appium check:
   a. AppiumDriver.initialize() → test session creation
   b. isAppInstalled("org.toshi") → check Base App present
   c. takeScreenshot("test_connection") → verify screenshot works
   d. AppiumDriver.cleanup()
4. Excel check:
   a. WalletStore.initializeExcel() → creates file if needed
   b. WalletStore.loadAccounts() → verify read
5. Log results with OK/FAIL for each check
```

---

## 4. Environment Configuration (.env.example)

```env
# Excel file paths
EXCEL_FILE_PATH=./data/accounts.xlsx     # Path to Excel workbook
ACCOUNTS_SHEET=Accounts                   # Sheet name for account data
LINKS_SHEET=Links                         # Sheet name for claim links

# Appium connection
APPIUM_HOST=localhost                     # Appium server host
APPIUM_PORT=4723                          # Appium server port
ANDROID_DEVICE_NAME=emulator-5554         # ADB device identifier

# Base App (Coinbase Wallet)
BASE_APP_PACKAGE=org.toshi                # Android package name
BASE_APP_ACTIVITY=.MainActivity           # Launch activity

# Timing (milliseconds)
ELEMENT_TIMEOUT=15000                     # Max wait for element to appear
ACTION_DELAY_MIN=2000                     # Min delay between actions (anti-detection)
ACTION_DELAY_MAX=5000                     # Max delay between actions
BETWEEN_ACCOUNTS_MIN=10000                # Min delay between account switches
BETWEEN_ACCOUNTS_MAX=30000                # Max delay between account switches
MAX_RETRIES=3                             # Retry attempts for failed operations

# Logging
LOG_LEVEL=info                            # winston log level (error/warn/info/debug)
```

**Total variables**: 15 (all have defaults in `loadConfig()`)

---

## 5. Summary

| Category | Count | Notes |
|----------|-------|-------|
| Total source files | 12 | Under `src/` |
| Config files | 4 | package.json, tsconfig.json, .env.example, .gitignore |
| Fully complete files | 9 | config, logger, delay, retry, wallet-store, adb-helpers, appium-driver, screenshot, account-manager |
| Files with placeholder selectors | 2 | base-app.ts (11 selector groups), miniapp-claimer.ts (7 selector groups) |
| Complete CLI commands | 5 | claim, scan, status, reset, test |
| Placeholder selector groups | 18 | Must be discovered on live emulator via `scan` command |

**Next Steps** (before production use):
1. Run `npm start scan` on emulator with Base App to discover real selectors
2. Replace all placeholder selectors in `base-app.ts` and `miniapp-claimer.ts`
3. Fix invalid `:has-text()` CSS pseudo-selectors in `miniapp-claimer.ts` WEB_SELECTORS
4. Test full `claim` flow end-to-end on real emulator
