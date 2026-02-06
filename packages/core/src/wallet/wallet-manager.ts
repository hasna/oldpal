/**
 * WalletManager - Core class for managing assistant payment cards
 * Handles card storage, rate limiting, and card data transformations
 *
 * SECURITY: Cards are NEVER stored locally on disk.
 * All card data is stored exclusively in AWS Secrets Manager and fetched
 * on-demand with rate limiting. This ensures:
 * - Encryption at rest (handled by AWS)
 * - No sensitive data on local filesystem
 * - Audit trail via AWS CloudTrail
 * - 30-day soft delete recovery window
 */

import type { WalletConfig } from '@hasna/assistants-shared';
import { SecretsClient } from './storage/secrets-client';
import type {
  Card,
  CardListItem,
  CardForAutomation,
  CardForPayment,
  AddCardInput,
  RateLimitState,
  WalletOperationResult,
} from './types';

export interface WalletManagerOptions {
  /** Assistant ID for scoping cards */
  assistantId: string;
  /** Wallet configuration */
  config: WalletConfig;
}

/**
 * WalletManager handles all wallet operations for an assistant
 */
export class WalletManager {
  private assistantId: string;
  private config: WalletConfig;
  private secretsClient: SecretsClient | null = null;
  private rateLimit: RateLimitState;
  private maxReadsPerHour: number;

  constructor(options: WalletManagerOptions) {
    this.assistantId = options.assistantId;
    this.config = options.config;
    this.maxReadsPerHour = options.config.security?.maxReadsPerHour ?? 10;
    this.rateLimit = {
      reads: 0,
      windowStart: Date.now(),
    };

    // Initialize Secrets Manager client if configured
    if (this.config.secrets?.region) {
      this.secretsClient = new SecretsClient({
        region: this.config.secrets.region,
        prefix: this.config.secrets.prefix,
        credentialsProfile: this.config.secrets.credentialsProfile,
      });
    }
  }

  /**
   * Check if wallet is properly configured
   */
  isConfigured(): boolean {
    return this.secretsClient !== null;
  }

  /**
   * List all cards (safe summaries only)
   */
  async list(): Promise<CardListItem[]> {
    if (!this.secretsClient) {
      return [];
    }

    try {
      return await this.secretsClient.listCards(this.assistantId);
    } catch (error) {
      this.logError('list', error);
      throw error;
    }
  }

  /**
   * Add a new card to the wallet
   */
  async add(input: AddCardInput): Promise<WalletOperationResult> {
    if (!this.secretsClient) {
      return {
        success: false,
        message: 'Wallet is not configured. Set wallet.secrets.region in config.',
      };
    }

    // Validate card number (basic Luhn check)
    if (!this.validateCardNumber(input.cardNumber)) {
      return {
        success: false,
        message: 'Invalid card number.',
      };
    }

    // Validate expiry
    if (!this.validateExpiry(input.expiryMonth, input.expiryYear)) {
      return {
        success: false,
        message: 'Card is expired or expiry date is invalid.',
      };
    }

    // Validate CVV
    if (!this.validateCVV(input.cvv)) {
      return {
        success: false,
        message: 'Invalid CVV. Must be 3-4 digits.',
      };
    }

    const now = new Date().toISOString();
    const cardId = this.generateCardId();

    const card: Card = {
      id: cardId,
      name: input.name,
      cardholderName: input.cardholderName,
      cardNumber: input.cardNumber.replace(/\s/g, ''), // Remove spaces
      expiryMonth: input.expiryMonth.padStart(2, '0'),
      expiryYear: input.expiryYear,
      cvv: input.cvv,
      billingAddress: input.billingAddress,
      cardType: this.detectCardType(input.cardNumber),
      createdAt: now,
      updatedAt: now,
      metadata: input.metadata,
    };

    try {
      await this.secretsClient.createCard(this.assistantId, card);
      this.logOperation('add', cardId, true);
      return {
        success: true,
        message: `Card "${input.name}" added successfully.`,
        cardId,
      };
    } catch (error) {
      this.logError('add', error);
      return {
        success: false,
        message: `Failed to add card: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Get full card details (rate limited)
   */
  async get(cardId: string): Promise<Card | null> {
    if (!this.secretsClient) {
      throw new Error('Wallet is not configured.');
    }

    // Check rate limit
    const rateLimitCheck = this.checkRateLimit();
    if (!rateLimitCheck.allowed) {
      throw new Error(
        `Rate limit exceeded. Maximum ${this.maxReadsPerHour} card reads per hour. ` +
        `Try again in ${rateLimitCheck.retryAfterMinutes} minutes.`
      );
    }

    try {
      const card = await this.secretsClient.getCard(this.assistantId, cardId);
      if (card) {
        this.incrementRateLimit();
        this.logOperation('get', cardId, true);
      }
      return card;
    } catch (error) {
      this.logError('get', error);
      throw error;
    }
  }

  /**
   * Get card formatted for browser automation (form filling)
   */
  async getForAutomation(cardId: string): Promise<CardForAutomation | null> {
    const card = await this.get(cardId);
    if (!card) return null;

    return {
      cardholderName: card.cardholderName,
      cardNumber: card.cardNumber,
      expiryMonth: card.expiryMonth,
      expiryYear: card.expiryYear,
      cvv: card.cvv,
      billingAddress: card.billingAddress,
    };
  }

  /**
   * Get card formatted for payment API calls
   */
  async getForPayment(cardId: string): Promise<CardForPayment | null> {
    const card = await this.get(cardId);
    if (!card) return null;

    return {
      number: card.cardNumber,
      expMonth: parseInt(card.expiryMonth, 10),
      expYear: parseInt(card.expiryYear, 10),
      cvc: card.cvv,
      name: card.cardholderName,
      address: card.billingAddress
        ? {
            line1: card.billingAddress.line1,
            line2: card.billingAddress.line2,
            city: card.billingAddress.city,
            state: card.billingAddress.state,
            postalCode: card.billingAddress.postalCode,
            country: card.billingAddress.country,
          }
        : undefined,
    };
  }

  /**
   * Remove a card from the wallet
   */
  async remove(cardId: string): Promise<WalletOperationResult> {
    if (!this.secretsClient) {
      return {
        success: false,
        message: 'Wallet is not configured.',
      };
    }

    try {
      // Verify card exists
      const card = await this.secretsClient.getCard(this.assistantId, cardId);
      if (!card) {
        return {
          success: false,
          message: `Card ${cardId} not found.`,
        };
      }

      await this.secretsClient.deleteCard(this.assistantId, cardId);
      this.logOperation('remove', cardId, true);
      return {
        success: true,
        message: `Card "${card.name}" removed. Recovery available for 30 days.`,
        cardId,
      };
    } catch (error) {
      this.logError('remove', error);
      return {
        success: false,
        message: `Failed to remove card: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Check if AWS credentials are configured and valid
   */
  async checkCredentials(): Promise<{ valid: boolean; error?: string }> {
    if (!this.secretsClient) {
      return {
        valid: false,
        error: 'Secrets Manager client not configured. Set wallet.secrets.region in config.',
      };
    }

    return this.secretsClient.checkCredentials();
  }

  /**
   * Get current rate limit status
   */
  getRateLimitStatus(): {
    readsUsed: number;
    maxReads: number;
    windowResetMinutes: number;
  } {
    this.maybeResetRateLimit();
    const elapsed = Date.now() - this.rateLimit.windowStart;
    const remaining = Math.max(0, 60 - Math.floor(elapsed / 60000));

    return {
      readsUsed: this.rateLimit.reads,
      maxReads: this.maxReadsPerHour,
      windowResetMinutes: remaining,
    };
  }

  // ============================================
  // Private helper methods
  // ============================================

  private checkRateLimit(): { allowed: boolean; retryAfterMinutes?: number } {
    this.maybeResetRateLimit();

    if (this.rateLimit.reads >= this.maxReadsPerHour) {
      const elapsed = Date.now() - this.rateLimit.windowStart;
      const retryAfter = Math.max(1, Math.ceil((3600000 - elapsed) / 60000));
      return { allowed: false, retryAfterMinutes: retryAfter };
    }

    return { allowed: true };
  }

  private incrementRateLimit(): void {
    this.maybeResetRateLimit();
    this.rateLimit.reads++;
  }

  private maybeResetRateLimit(): void {
    const elapsed = Date.now() - this.rateLimit.windowStart;
    if (elapsed >= 3600000) { // 1 hour in ms
      this.rateLimit = {
        reads: 0,
        windowStart: Date.now(),
      };
    }
  }

  private validateCardNumber(number: string): boolean {
    const cleaned = number.replace(/\D/g, '');
    if (cleaned.length < 13 || cleaned.length > 19) {
      return false;
    }

    // Luhn algorithm
    let sum = 0;
    let isEven = false;
    for (let i = cleaned.length - 1; i >= 0; i--) {
      let digit = parseInt(cleaned[i], 10);
      if (isEven) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
      isEven = !isEven;
    }
    return sum % 10 === 0;
  }

  private validateExpiry(month: string, year: string): boolean {
    const m = parseInt(month, 10);
    const y = parseInt(year, 10);

    if (m < 1 || m > 12) return false;

    const fullYear = y < 100 ? 2000 + y : y;
    const now = new Date();
    const expiry = new Date(fullYear, m, 0); // Last day of expiry month

    return expiry >= now;
  }

  private validateCVV(cvv: string): boolean {
    return /^\d{3,4}$/.test(cvv);
  }

  private detectCardType(number: string): Card['cardType'] {
    const cleaned = number.replace(/\D/g, '');

    if (/^4/.test(cleaned)) return 'visa';
    if (/^5[1-5]/.test(cleaned) || /^2[2-7]/.test(cleaned)) return 'mastercard';
    if (/^3[47]/.test(cleaned)) return 'amex';
    if (/^6(?:011|5)/.test(cleaned)) return 'discover';

    return 'other';
  }

  private generateCardId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `card_${timestamp}${random}`;
  }

  private logOperation(operation: string, cardId: string, success: boolean): void {
    // Log operation without sensitive data
    // In production, this would go to a secure audit log
    const logEntry = {
      timestamp: new Date().toISOString(),
      assistantId: this.assistantId,
      operation,
      cardId,
      success,
    };

    // For now, just log to stderr in debug mode
    if (process.env.DEBUG) {
      console.error('[wallet]', JSON.stringify(logEntry));
    }
  }

  private logError(operation: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const logEntry = {
      timestamp: new Date().toISOString(),
      assistantId: this.assistantId,
      operation,
      error: message,
    };

    console.error('[wallet error]', JSON.stringify(logEntry));
  }
}

/**
 * Create a WalletManager from config
 */
export function createWalletManager(
  assistantId: string,
  config: WalletConfig
): WalletManager {
  return new WalletManager({
    assistantId,
    config,
  });
}
