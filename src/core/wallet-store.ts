import ExcelJS from "exceljs";
import path from "path";
import fs from "fs";
import { WalletData, CreateWalletConfig } from "./config";
import { logger } from "../utils/logger";

const WALLET_COLUMNS: Partial<ExcelJS.Column>[] = [
  { header: "#", key: "id", width: 6 },
  { header: "Wallet Name", key: "walletName", width: 30 },
  { header: "Wallet Address", key: "walletAddress", width: 46 },
  { header: "PIN", key: "pin", width: 10 },
  { header: "Created At", key: "createdAt", width: 22 },
  { header: "Status", key: "status", width: 12 },
];

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1F4E79" },
};

const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFFFFFFF" },
  size: 11,
};

const ZEBRA_EVEN_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFD6E4F0" },
};

const ZEBRA_ODD_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFFFFFF" },
};

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin" },
  bottom: { style: "thin" },
  left: { style: "thin" },
  right: { style: "thin" },
};

const STATUS_CREATED_FONT: Partial<ExcelJS.Font> = {
  color: { argb: "FF006100" },
  bold: true,
};

const STATUS_CREATED_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFC6EFCE" },
};

const STATUS_FAILED_FONT: Partial<ExcelJS.Font> = {
  color: { argb: "FF9C0006" },
  bold: true,
};

const STATUS_FAILED_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFFC7CE" },
};

const ADDRESS_FONT: Partial<ExcelJS.Font> = {
  name: "Consolas",
  size: 10,
};

export class WalletStore {
  private filePath: string;
  private walletsSheet: string;
  private summarySheet: string;
  private sessionStartTime: string;

  constructor(config: CreateWalletConfig) {
    this.filePath = config.excelFilePath;
    this.walletsSheet = config.walletsSheet;
    this.summarySheet = config.summarySheet;
    this.sessionStartTime = new Date().toISOString();
  }

  private ensureDirectory(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private async getWorkbook(): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();
    if (fs.existsSync(this.filePath)) {
      await workbook.xlsx.readFile(this.filePath);
    }
    return workbook;
  }

  private styleHeaderRow(sheet: ExcelJS.Worksheet): void {
    const headerRow = sheet.getRow(1);
    headerRow.eachCell((cell) => {
      cell.fill = HEADER_FILL;
      cell.font = HEADER_FONT;
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.border = THIN_BORDER;
    });
    headerRow.height = 22;
  }

  private styleDataRow(row: ExcelJS.Row, rowNumber: number): void {
    const isEven = rowNumber % 2 === 0;
    const baseFill = isEven ? ZEBRA_EVEN_FILL : ZEBRA_ODD_FILL;

    row.eachCell((cell, colNumber) => {
      cell.border = THIN_BORDER;
      cell.alignment = { vertical: "middle" };

      // Column 3 = Wallet Address → monospace font
      if (colNumber === 3) {
        cell.font = { ...ADDRESS_FONT };
      }

      // Column 4 = PIN → format as text
      if (colNumber === 4) {
        cell.numFmt = "@";
      }

      // Column 6 = Status → conditional color
      if (colNumber === 6) {
        const val = String(cell.value || "").toLowerCase();
        if (val === "created") {
          cell.font = STATUS_CREATED_FONT;
          cell.fill = STATUS_CREATED_FILL;
        } else if (val === "failed") {
          cell.font = STATUS_FAILED_FONT;
          cell.fill = STATUS_FAILED_FILL;
        } else {
          cell.fill = baseFill;
        }
        return;
      }

      cell.fill = baseFill;
    });
  }

  async initializeExcel(): Promise<void> {
    this.ensureDirectory();

    if (fs.existsSync(this.filePath)) {
      logger.info("Excel file already exists, skipping initialization");
      return;
    }

    const workbook = new ExcelJS.Workbook();

    // Create Wallets sheet
    const walletsSheet = workbook.addWorksheet(this.walletsSheet);
    walletsSheet.columns = WALLET_COLUMNS;
    this.styleHeaderRow(walletsSheet);

    // Freeze top row
    walletsSheet.views = [
      { state: "frozen", ySplit: 1, xSplit: 0, activeCell: "A2" },
    ];

    // Auto-filter on header
    walletsSheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: WALLET_COLUMNS.length },
    };

    // Create Summary sheet
    const summarySheet = workbook.addWorksheet(this.summarySheet);
    summarySheet.columns = [
      { header: "Metric", key: "metric", width: 25 },
      { header: "Value", key: "value", width: 30 },
    ];
    this.styleHeaderRow(summarySheet);
    this.writeSummaryData(summarySheet, [], this.sessionStartTime);

    await workbook.xlsx.writeFile(this.filePath);
    logger.info(`Initialized Excel file at ${this.filePath}`);
  }

  async loadWallets(): Promise<WalletData[]> {
    const workbook = await this.getWorkbook();
    const sheet = workbook.getWorksheet(this.walletsSheet);

    if (!sheet) {
      logger.warn(
        `Sheet "${this.walletsSheet}" not found. Returning empty list.`
      );
      return [];
    }

    const wallets: WalletData[] = [];

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;

      const wallet: WalletData = {
        id: Number(row.getCell(1).value) || rowNumber - 1,
        walletName: String(row.getCell(2).value || ""),
        walletAddress: String(row.getCell(3).value || ""),
        pin: String(row.getCell(4).value || ""),
        createdAt: String(row.getCell(5).value || ""),
        status: String(row.getCell(6).value || "failed") as WalletData["status"],
      };

      wallets.push(wallet);
    });

    logger.info(`Loaded ${wallets.length} wallets from Excel`);
    return wallets;
  }

  async appendWallet(wallet: WalletData): Promise<void> {
    this.ensureDirectory();
    const workbook = await this.getWorkbook();

    // Get or create Wallets sheet
    let sheet = workbook.getWorksheet(this.walletsSheet);
    if (!sheet) {
      sheet = workbook.addWorksheet(this.walletsSheet);
      sheet.columns = WALLET_COLUMNS;
      this.styleHeaderRow(sheet);
      sheet.views = [
        { state: "frozen", ySplit: 1, xSplit: 0, activeCell: "A2" },
      ];
    }

    // Append data row (PIN excluded — set separately to preserve text format)
    const newRow = sheet.addRow({
      id: wallet.id,
      walletName: wallet.walletName,
      walletAddress: wallet.walletAddress,
      pin: "",
      createdAt: wallet.createdAt,
      status: wallet.status,
    });

    // Set PIN cell as text BEFORE assigning value (prevents "0123" → 123)
    const pinCell = newRow.getCell(4);
    pinCell.numFmt = "@";
    pinCell.value = wallet.pin;

    // Style the new row
    this.styleDataRow(newRow, newRow.number);

    // Update auto-filter to cover all data rows
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: sheet.rowCount, column: WALLET_COLUMNS.length },
    };

    // Update Summary sheet
    await this.updateSummarySheet(workbook);

    await workbook.xlsx.writeFile(this.filePath);
    logger.info(
      `Appended wallet #${wallet.id}: ${wallet.walletName} (${wallet.status})`
    );
  }

  private async updateSummarySheet(workbook: ExcelJS.Workbook): Promise<void> {
    // Load all wallet data to compute summary
    const walletsSheet = workbook.getWorksheet(this.walletsSheet);
    const wallets: WalletData[] = [];

    if (walletsSheet) {
      walletsSheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        wallets.push({
          id: Number(row.getCell(1).value) || 0,
          walletName: String(row.getCell(2).value || ""),
          walletAddress: String(row.getCell(3).value || ""),
          pin: String(row.getCell(4).value || ""),
          createdAt: String(row.getCell(5).value || ""),
          status: String(row.getCell(6).value || "failed") as WalletData["status"],
        });
      });
    }

    // Remove existing Summary sheet and recreate
    let summarySheet = workbook.getWorksheet(this.summarySheet);
    if (summarySheet) {
      workbook.removeWorksheet(summarySheet.id);
    }

    summarySheet = workbook.addWorksheet(this.summarySheet);
    summarySheet.columns = [
      { header: "Metric", key: "metric", width: 25 },
      { header: "Value", key: "value", width: 30 },
    ];
    this.styleHeaderRow(summarySheet);
    this.writeSummaryData(summarySheet, wallets, this.sessionStartTime);
  }

  private writeSummaryData(
    sheet: ExcelJS.Worksheet,
    wallets: WalletData[],
    startTime: string
  ): void {
    const total = wallets.length;
    const created = wallets.filter((w) => w.status === "created").length;
    const failed = wallets.filter((w) => w.status === "failed").length;

    const rows = [
      { metric: "Total Wallets", value: String(total) },
      { metric: "Created Successfully", value: String(created) },
      { metric: "Failed", value: String(failed) },
      {
        metric: "Success Rate",
        value: total > 0 ? `${((created / total) * 100).toFixed(1)}%` : "N/A",
      },
      { metric: "Session Start", value: startTime },
      { metric: "Last Updated", value: new Date().toISOString() },
    ];

    for (const row of rows) {
      const dataRow = sheet.addRow(row);
      const rowNum = dataRow.number;
      const isEven = rowNum % 2 === 0;

      dataRow.eachCell((cell) => {
        cell.border = THIN_BORDER;
        cell.fill = isEven ? ZEBRA_EVEN_FILL : ZEBRA_ODD_FILL;
        cell.alignment = { vertical: "middle" };
      });

      // Color the success/failed value cells
      const metricVal = String(dataRow.getCell(1).value);
      const valueCell = dataRow.getCell(2);

      if (metricVal === "Created Successfully" && created > 0) {
        valueCell.font = STATUS_CREATED_FONT;
      } else if (metricVal === "Failed" && failed > 0) {
        valueCell.font = STATUS_FAILED_FONT;
      }
    }
  }

  async exportReport(): Promise<void> {
    const wallets = await this.loadWallets();

    const total = wallets.length;
    const created = wallets.filter((w) => w.status === "created").length;
    const failed = wallets.filter((w) => w.status === "failed").length;

    logger.info("=== WALLET CREATION REPORT ===");
    logger.info(`Total wallets:  ${total}`);
    logger.info(`Created:        ${created}`);
    logger.info(`Failed:         ${failed}`);
    logger.info(
      `Success rate:   ${total > 0 ? ((created / total) * 100).toFixed(1) : 0}%`
    );
    logger.info("==============================");
  }
}
