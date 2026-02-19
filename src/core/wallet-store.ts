import ExcelJS from "exceljs";
import path from "path";
import fs from "fs";
import { AccountData, AppConfig } from "./config";
import { logger } from "../utils/logger";

const ACCOUNT_COLUMNS = [
  { header: "#", key: "id", width: 6 },
  { header: "Email", key: "email", width: 30 },
  { header: "Password", key: "password", width: 20 },
  { header: "Wallet Address", key: "walletAddress", width: 45 },
  { header: "Recovery Phrase", key: "recoveryPhrase", width: 50 },
  { header: "Claim Status", key: "claimStatus", width: 15 },
  { header: "Claim Link", key: "claimLink", width: 50 },
  { header: "Last Attempt", key: "lastAttempt", width: 22 },
  { header: "Error", key: "errorMessage", width: 40 },
];

const LINK_COLUMNS = [
  { header: "Claim Link", key: "claimLink", width: 60 },
  { header: "Description", key: "description", width: 40 },
];

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF4472C4" },
};

const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFFFFFFF" },
};

export class WalletStore {
  private filePath: string;
  private accountsSheet: string;
  private linksSheet: string;

  constructor(config: AppConfig) {
    this.filePath = config.excelFilePath;
    this.accountsSheet = config.accountsSheet;
    this.linksSheet = config.claimLinksSheet;
  }

  private async getWorkbook(): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();

    if (fs.existsSync(this.filePath)) {
      await workbook.xlsx.readFile(this.filePath);
    }

    return workbook;
  }

  private ensureDirectory(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private styleHeaderRow(sheet: ExcelJS.Worksheet): void {
    const headerRow = sheet.getRow(1);
    headerRow.eachCell((cell) => {
      cell.fill = HEADER_FILL;
      cell.font = HEADER_FONT;
      cell.alignment = { vertical: "middle", horizontal: "center" };
    });
  }

  async loadAccounts(): Promise<AccountData[]> {
    const workbook = await this.getWorkbook();
    const sheet = workbook.getWorksheet(this.accountsSheet);

    if (!sheet) {
      logger.warn(`Sheet "${this.accountsSheet}" not found. Returning empty list.`);
      return [];
    }

    const accounts: AccountData[] = [];

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // Skip header

      const account: AccountData = {
        id: Number(row.getCell(1).value) || rowNumber - 1,
        email: String(row.getCell(2).value || ""),
        password: String(row.getCell(3).value || ""),
        walletAddress: String(row.getCell(4).value || ""),
        recoveryPhrase: String(row.getCell(5).value || ""),
        claimStatus: (String(row.getCell(6).value || "pending") as AccountData["claimStatus"]),
        claimLink: String(row.getCell(7).value || ""),
        lastAttempt: String(row.getCell(8).value || ""),
        errorMessage: row.getCell(9).value ? String(row.getCell(9).value) : undefined,
      };

      if (account.email) {
        accounts.push(account);
      }
    });

    logger.info(`Loaded ${accounts.length} accounts from Excel`);
    return accounts;
  }

  async saveAccounts(accounts: AccountData[]): Promise<void> {
    this.ensureDirectory();
    const workbook = await this.getWorkbook();

    let sheet = workbook.getWorksheet(this.accountsSheet);
    if (sheet) {
      workbook.removeWorksheet(sheet.id);
    }

    sheet = workbook.addWorksheet(this.accountsSheet);
    sheet.columns = ACCOUNT_COLUMNS;
    this.styleHeaderRow(sheet);

    for (const account of accounts) {
      sheet.addRow({
        id: account.id,
        email: account.email,
        password: account.password,
        walletAddress: account.walletAddress,
        recoveryPhrase: account.recoveryPhrase,
        claimStatus: account.claimStatus,
        claimLink: account.claimLink,
        lastAttempt: account.lastAttempt,
        errorMessage: account.errorMessage || "",
      });
    }

    await workbook.xlsx.writeFile(this.filePath);
    logger.info(`Saved ${accounts.length} accounts to Excel`);
  }

  async updateAccountStatus(
    id: number,
    status: AccountData["claimStatus"],
    errorMsg?: string
  ): Promise<void> {
    const workbook = await this.getWorkbook();
    const sheet = workbook.getWorksheet(this.accountsSheet);

    if (!sheet) {
      throw new Error(`Sheet "${this.accountsSheet}" not found`);
    }

    let updated = false;

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      if (Number(row.getCell(1).value) === id) {
        row.getCell(6).value = status;
        row.getCell(8).value = new Date().toISOString();
        if (errorMsg !== undefined) {
          row.getCell(9).value = errorMsg;
        }
        updated = true;
      }
    });

    if (!updated) {
      throw new Error(`Account with id ${id} not found`);
    }

    await workbook.xlsx.writeFile(this.filePath);
    logger.info(`Updated account #${id} status to "${status}"`);
  }

  async loadClaimLinks(): Promise<string[]> {
    const workbook = await this.getWorkbook();
    const sheet = workbook.getWorksheet(this.linksSheet);

    if (!sheet) {
      logger.warn(`Sheet "${this.linksSheet}" not found. Returning empty list.`);
      return [];
    }

    const links: string[] = [];

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const link = String(row.getCell(1).value || "").trim();
      if (link) {
        links.push(link);
      }
    });

    logger.info(`Loaded ${links.length} claim links from Excel`);
    return links;
  }

  async exportReport(): Promise<void> {
    const accounts = await this.loadAccounts();

    const total = accounts.length;
    const claimed = accounts.filter((a) => a.claimStatus === "claimed").length;
    const failed = accounts.filter((a) => a.claimStatus === "failed").length;
    const pending = accounts.filter((a) => a.claimStatus === "pending").length;
    const skipped = accounts.filter((a) => a.claimStatus === "skipped").length;

    logger.info("=== CLAIM REPORT ===");
    logger.info(`Total accounts: ${total}`);
    logger.info(`Claimed:        ${claimed}`);
    logger.info(`Failed:         ${failed}`);
    logger.info(`Pending:        ${pending}`);
    logger.info(`Skipped:        ${skipped}`);
    logger.info(`Success rate:   ${total > 0 ? ((claimed / total) * 100).toFixed(1) : 0}%`);
    logger.info("====================");
  }

  async initializeExcel(): Promise<void> {
    this.ensureDirectory();

    if (fs.existsSync(this.filePath)) {
      logger.info("Excel file already exists, skipping initialization");
      return;
    }

    const workbook = new ExcelJS.Workbook();

    const accountsSheet = workbook.addWorksheet(this.accountsSheet);
    accountsSheet.columns = ACCOUNT_COLUMNS;
    this.styleHeaderRow(accountsSheet);

    const linksSheet = workbook.addWorksheet(this.linksSheet);
    linksSheet.columns = LINK_COLUMNS;
    this.styleHeaderRow(linksSheet);

    await workbook.xlsx.writeFile(this.filePath);
    logger.info(`Initialized Excel file at ${this.filePath}`);
  }
}
