import { AccountData, AppConfig } from "./config";
import { WalletStore } from "./wallet-store";
import { logger } from "../utils/logger";

export class AccountManager {
  private store: WalletStore;
  private pendingAccounts: AccountData[] = [];
  private currentIndex: number = 0;

  constructor(config: AppConfig) {
    this.store = new WalletStore(config);
  }

  async loadPendingAccounts(): Promise<AccountData[]> {
    const allAccounts = await this.store.loadAccounts();
    this.pendingAccounts = allAccounts.filter(
      (a) => a.claimStatus === "pending"
    );
    this.currentIndex = 0;
    logger.info(
      `Found ${this.pendingAccounts.length} pending accounts out of ${allAccounts.length} total`
    );
    return this.pendingAccounts;
  }

  assignLinksToAccounts(accounts: AccountData[], links: string[]): void {
    for (let i = 0; i < accounts.length; i++) {
      if (i < links.length) {
        accounts[i].claimLink = links[i];
      } else if (!accounts[i].claimLink) {
        // Use the first link as default if not enough links
        accounts[i].claimLink = links[0] || "";
        if (links.length > 0) {
          logger.warn(
            `Account #${accounts[i].id}: No unique link available, using first link`
          );
        }
      }
    }
    logger.info(
      `Assigned ${Math.min(accounts.length, links.length)} links to accounts`
    );
  }

  async getNextAccount(): Promise<AccountData | null> {
    if (this.currentIndex >= this.pendingAccounts.length) {
      return null;
    }
    const account = this.pendingAccounts[this.currentIndex];
    this.currentIndex++;
    return account;
  }

  async updateStatus(
    accountId: number,
    status: AccountData["claimStatus"],
    errorMsg?: string
  ): Promise<void> {
    await this.store.updateAccountStatus(accountId, status, errorMsg);
  }

  async exportReport(): Promise<void> {
    await this.store.exportReport();
  }

  async initializeExcel(): Promise<void> {
    await this.store.initializeExcel();
  }

  getStore(): WalletStore {
    return this.store;
  }

  getPendingCount(): number {
    return this.pendingAccounts.length - this.currentIndex;
  }

  getTotalPending(): number {
    return this.pendingAccounts.length;
  }
}
