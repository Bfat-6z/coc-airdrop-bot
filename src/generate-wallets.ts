import { ethers } from "ethers";
import ExcelJS from "exceljs";
import path from "path";
import fs from "fs";

const WALLET_COUNT = 1000;
const DEFAULT_PASSWORD = "Tuilaben2007!!";

interface WalletInfo {
  id: number;
  address: string;
  mnemonic: string;
  word1: string;
  word12: string;
  password: string;
  createdAt: string;
}

async function generateWallets(): Promise<WalletInfo[]> {
  const wallets: WalletInfo[] = [];

  console.log(`Generating ${WALLET_COUNT} wallets...`);

  for (let i = 1; i <= WALLET_COUNT; i++) {
    const wallet = ethers.Wallet.createRandom();
    const mnemonic = wallet.mnemonic!.phrase;
    const words = mnemonic.split(" ");

    wallets.push({
      id: i,
      address: wallet.address,
      mnemonic: mnemonic,
      word1: words[0],
      word12: words[11],
      password: DEFAULT_PASSWORD,
      createdAt: new Date().toISOString(),
    });

    if (i % 100 === 0) {
      console.log(`Generated ${i}/${WALLET_COUNT} wallets`);
    }
  }

  console.log(`Done! Generated ${wallets.length} wallets`);
  return wallets;
}

async function saveToExcel(wallets: WalletInfo[]): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "COC-Airdrop-Bot";
  workbook.created = new Date();

  // ==================== SHEET 1: Wallets ====================
  const ws = workbook.addWorksheet("Wallets");

  ws.columns = [
    { header: "#", key: "id", width: 6 },
    { header: "Wallet Address", key: "address", width: 46 },
    { header: "Mnemonic (12 Words)", key: "mnemonic", width: 75 },
    { header: "Word 1 (First)", key: "word1", width: 16 },
    { header: "Word 12 (Last)", key: "word12", width: 16 },
    { header: "Password", key: "password", width: 20 },
    { header: "Created At", key: "createdAt", width: 22 },
  ];

  // Header styling
  const headerRow = ws.getRow(1);
  headerRow.height = 30;
  headerRow.eachCell((cell) => {
    cell.font = {
      bold: true,
      color: { argb: "FFFFFFFF" },
      size: 11,
      name: "Calibri",
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F4E79" },
    };
    cell.alignment = {
      vertical: "middle",
      horizontal: "center",
      wrapText: true,
    };
    cell.border = {
      top: { style: "thin", color: { argb: "FF000000" } },
      bottom: { style: "thin", color: { argb: "FF000000" } },
      left: { style: "thin", color: { argb: "FF000000" } },
      right: { style: "thin", color: { argb: "FF000000" } },
    };
  });

  // Data rows
  wallets.forEach((w, idx) => {
    const row = ws.addRow({
      id: w.id,
      address: w.address,
      mnemonic: w.mnemonic,
      word1: w.word1,
      word12: w.word12,
      password: w.password,
      createdAt: w.createdAt,
    });

    const isEven = idx % 2 === 0;
    const bgColor = isEven ? "FFD6E4F0" : "FFFFFFFF";

    row.eachCell((cell, colNumber) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: bgColor },
      };
      cell.border = {
        top: { style: "thin", color: { argb: "FFD0D0D0" } },
        bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
        left: { style: "thin", color: { argb: "FFD0D0D0" } },
        right: { style: "thin", color: { argb: "FFD0D0D0" } },
      };
      cell.alignment = { vertical: "middle" };

      // Wallet Address column — monospace
      if (colNumber === 2) {
        cell.font = { name: "Consolas", size: 10 };
      }

      // Mnemonic column — monospace, smaller
      if (colNumber === 3) {
        cell.font = { name: "Consolas", size: 9 };
        cell.alignment = { vertical: "middle", wrapText: true };
      }
    });
  });

  // Freeze header row
  ws.views = [{ state: "frozen" as const, ySplit: 1 }];

  // Auto-filter
  ws.autoFilter = { from: "A1", to: "G1" };

  // ==================== SHEET 2: Summary ====================
  const summary = workbook.addWorksheet("Summary");
  summary.columns = [
    { header: "Metric", key: "metric", width: 25 },
    { header: "Value", key: "value", width: 40 },
  ];

  const summaryHeader = summary.getRow(1);
  summaryHeader.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F4E79" },
    };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = {
      top: { style: "thin" },
      bottom: { style: "thin" },
      left: { style: "thin" },
      right: { style: "thin" },
    };
  });

  const summaryData = [
    { metric: "Total Wallets", value: String(wallets.length) },
    { metric: "Default Password", value: DEFAULT_PASSWORD },
    { metric: "Mnemonic Type", value: "BIP39 - 12 Words" },
    { metric: "Network", value: "Ethereum / Base (EVM Compatible)" },
    {
      metric: "Compatible With",
      value: "Coinbase Wallet Extension, MetaMask, etc.",
    },
    { metric: "Generated At", value: new Date().toISOString() },
  ];

  summaryData.forEach((item, idx) => {
    const row = summary.addRow(item);
    const bgColor = idx % 2 === 0 ? "FFD6E4F0" : "FFFFFFFF";
    row.eachCell((cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: bgColor },
      };
      cell.border = {
        top: { style: "thin", color: { argb: "FFD0D0D0" } },
        bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
        left: { style: "thin", color: { argb: "FFD0D0D0" } },
        right: { style: "thin", color: { argb: "FFD0D0D0" } },
      };
    });
  });

  // Save
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const filePath = path.join(dataDir, "wallets_1000.xlsx");
  await workbook.xlsx.writeFile(filePath);
  console.log(`Excel saved: ${filePath}`);
  return filePath;
}

async function main() {
  console.log("=== COC Wallet Generator ===");
  console.log(
    `Generating ${WALLET_COUNT} wallets with password: ${DEFAULT_PASSWORD}`
  );
  console.log("");

  const startTime = Date.now();
  const wallets = await generateWallets();
  const filePath = await saveToExcel(wallets);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log("");
  console.log(`Done: ${wallets.length} wallets generated in ${elapsed}s`);
  console.log(`File: ${filePath}`);
  console.log(`First: ${wallets[0].address}`);
  console.log(`Last:  ${wallets[wallets.length - 1].address}`);
}

main().catch(console.error);
