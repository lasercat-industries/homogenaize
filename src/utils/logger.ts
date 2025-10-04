/**
 * Browser-safe logger implementation that mimics Winston API
 * Works in both Node.js and browser environments with colors support
 */

/**
 * Logger configuration options
 */
export interface LoggerConfig {
  /** Log level: error, warn, info, debug, verbose, or silent */
  level?: 'error' | 'warn' | 'info' | 'debug' | 'verbose' | 'silent';
  /** Output format: json for structured logs, pretty for human-readable */
  format?: 'json' | 'pretty';
  /** Optional prefix for all log messages */
  prefix?: string;
  /** Custom transports (for compatibility, not used in this implementation) */
  transports?: unknown[];
}

// Log level priorities
const LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  verbose: 4,
  silent: 5,
} as const;

// Console colors for different log levels
const COLORS = {
  error: '\x1b[31m', // red
  warn: '\x1b[33m', // yellow
  info: '\x1b[32m', // green
  debug: '\x1b[34m', // blue
  verbose: '\x1b[36m', // cyan
  reset: '\x1b[0m',
} as const;

// Browser console colors (CSS)
const BROWSER_COLORS = {
  error: 'color: #dc3545; font-weight: bold',
  warn: 'color: #ffc107; font-weight: bold',
  info: 'color: #28a745; font-weight: bold',
  debug: 'color: #007bff; font-weight: bold',
  verbose: 'color: #17a2b8; font-weight: bold',
} as const;

type LogLevel = keyof typeof LEVELS;
type LogMethod = 'error' | 'warn' | 'info' | 'debug' | 'verbose';

// Detect environment
const isBrowser = typeof globalThis !== 'undefined' && 'document' in globalThis;
const isNode =
  typeof globalThis !== 'undefined' &&
  'process' in globalThis &&
  (globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node;

function getLogLevelFromEnv(): string | undefined {
  if (isNode && typeof process !== 'undefined') {
    return process.env.HOMOGENAIZE_LOG_LEVEL;
  }
  // For Vite and other bundlers that replace import.meta.env at build time
  try {
    // Check for import.meta.env (Vite, Snowpack, etc.)
    const metaEnv = (import.meta as { env?: Record<string, unknown> })?.env;
    if (metaEnv) {
      return (
        (metaEnv.HOMOGENAIZE_LOG_LEVEL as string | undefined) ||
        (metaEnv.VITE_HOMOGENAIZE_LOG_LEVEL as string | undefined)
      );
    }
  } catch {
    // Ignore errors from import.meta access
  }
  return undefined;
}

function getLogFormatFromEnv(): string | undefined {
  if (isNode && typeof process !== 'undefined') {
    return process.env.HOMOGENAIZE_LOG_FORMAT;
  }
  // For Vite and other bundlers that replace import.meta.env at build time
  try {
    // Check for import.meta.env (Vite, Snowpack, etc.)
    const metaEnv = (import.meta as { env?: Record<string, unknown> })?.env;
    if (metaEnv) {
      return (
        (metaEnv.HOMOGENAIZE_LOG_FORMAT as string | undefined) ||
        (metaEnv.VITE_HOMOGENAIZE_LOG_FORMAT as string | undefined)
      );
    }
  } catch {
    // Ignore errors from import.meta access
  }
  return undefined;
}

/**
 * Masks sensitive data in log messages
 */
function sanitizeData(data: unknown): unknown {
  if (typeof data === 'string') {
    // Mask API keys
    return data.replace(/(sk-[a-zA-Z0-9]{20,}|AI[a-zA-Z0-9]{35,})/g, '***REDACTED***');
  }

  if (typeof data === 'object' && data !== null) {
    if (Array.isArray(data)) {
      return data.map((item) => sanitizeData(item));
    }

    const sanitized: Record<string, unknown> = {};
    const obj = data as Record<string, unknown>;

    for (const key in obj) {
      if (
        key.toLowerCase().includes('key') ||
        key.toLowerCase().includes('token') ||
        key.toLowerCase().includes('secret') ||
        key.toLowerCase().includes('password')
      ) {
        sanitized[key] = '***REDACTED***';
      } else {
        sanitized[key] = sanitizeData(obj[key]);
      }
    }

    return sanitized;
  }

  return data;
}

class BrowserSafeLogger {
  private currentLevel: LogLevel = 'silent';
  private currentFormat: 'json' | 'pretty' = 'pretty';
  private prefix?: string;
  private context?: string;

  constructor(config?: LoggerConfig, context?: string) {
    if (config) {
      this.updateConfig(config);
    }
    this.context = context;
  }

  private updateConfig(config: LoggerConfig): void {
    this.currentLevel = config.level || this.currentLevel;
    this.currentFormat = config.format || this.currentFormat;
    this.prefix = config.prefix;
  }

  /**
   * Check if a log level is enabled
   */
  private isLevelEnabled(level: LogLevel): boolean {
    if (this.currentLevel === 'silent') return false;
    return LEVELS[level] <= LEVELS[this.currentLevel];
  }

  /**
   * Format the timestamp
   */
  private getTimestamp(): string {
    return new Date().toISOString();
  }

  /**
   * Format the log message based on configuration
   */
  private formatMessage(
    level: LogLevel,
    message: string,
    metadata?: unknown,
  ): { formattedMessage: string; args: unknown[] } {
    const timestamp = this.getTimestamp();
    const sanitizedMessage = sanitizeData(message);
    const sanitizedMetadata = metadata ? sanitizeData(metadata) : undefined;
    const contextPrefix = this.context ? `[${this.context}] ` : '';
    const customPrefix = this.prefix ? `${this.prefix} ` : '';

    if (this.currentFormat === 'json') {
      const logObject: Record<string, unknown> = {
        timestamp,
        level,
        message: `${customPrefix}${contextPrefix}${sanitizedMessage}`,
      };
      if (sanitizedMetadata) {
        logObject.metadata = sanitizedMetadata;
      }
      return { formattedMessage: JSON.stringify(logObject), args: [] };
    }

    // Pretty format with colors
    let formattedMessage = '';
    const args: unknown[] = [];

    if (isBrowser) {
      // Browser with CSS colors
      const style = BROWSER_COLORS[level as keyof typeof BROWSER_COLORS] || '';
      formattedMessage = `%c${timestamp} [${level.toUpperCase()}]: %c${customPrefix}${contextPrefix}${sanitizedMessage}`;
      args.push(style, 'color: inherit');
    } else if (isNode) {
      // Node.js with ANSI colors
      const color = COLORS[level as keyof typeof COLORS] || '';
      formattedMessage = `${color}${timestamp} [${level.toUpperCase()}]: ${COLORS.reset}${customPrefix}${contextPrefix}${sanitizedMessage}`;
    } else {
      // Fallback - no colors
      formattedMessage = `${timestamp} [${level.toUpperCase()}]: ${customPrefix}${contextPrefix}${sanitizedMessage}`;
    }

    if (sanitizedMetadata && Object.keys(sanitizedMetadata as object).length > 0) {
      formattedMessage += ' ' + JSON.stringify(sanitizedMetadata);
    }

    return { formattedMessage, args };
  }

  /**
   * Core logging method
   */
  private log(level: LogMethod, message: string, ...meta: unknown[]): void {
    if (!this.isLevelEnabled(level)) return;

    const metadata = meta.length > 0 ? (meta.length === 1 ? meta[0] : meta) : undefined;
    const { formattedMessage, args } = this.formatMessage(level, message, metadata);

    // Use appropriate console method
    const consoleMethod = level === 'verbose' ? 'log' : level;
    if (args.length > 0) {
      console[consoleMethod](formattedMessage, ...args);
    } else {
      console[consoleMethod](formattedMessage);
    }
  }

  // Winston-compatible logging methods
  error(message: string, ...meta: unknown[]): void {
    this.log('error', message, ...meta);
  }

  warn(message: string, ...meta: unknown[]): void {
    this.log('warn', message, ...meta);
  }

  info(message: string, ...meta: unknown[]): void {
    this.log('info', message, ...meta);
  }

  debug(message: string, ...meta: unknown[]): void {
    this.log('debug', message, ...meta);
  }

  verbose(message: string, ...meta: unknown[]): void {
    this.log('verbose', message, ...meta);
  }

  // Winston-compatible child logger
  child(options: { context?: string; [key: string]: unknown }): BrowserSafeLogger {
    const childContext = options.context
      ? this.context
        ? `${this.context}:${options.context}`
        : options.context
      : this.context;
    const childLogger = new BrowserSafeLogger(
      {
        level: this.currentLevel,
        format: this.currentFormat,
        prefix: this.prefix,
      },
      childContext,
    );
    return childLogger;
  }

  // Property getters/setters for Winston compatibility
  get level(): string {
    return this.currentLevel;
  }

  set level(value: string) {
    this.currentLevel = value as LogLevel;
  }

  get silent(): boolean {
    return this.currentLevel === 'silent';
  }

  set silent(value: boolean) {
    if (value) {
      this.currentLevel = 'silent';
    }
  }

  // Configure method for Winston compatibility
  configure(config: LoggerConfig): void {
    this.updateConfig(config);
  }

  // Transports array for compatibility (not actually used)
  transports: unknown[] = [];
}

// Singleton logger instance
let loggerInstance: BrowserSafeLogger | null = null;
let currentConfig: LoggerConfig = { level: 'silent' };

/**
 * Configure the global logger
 * @param config - Logger configuration or boolean (true = info, false = silent)
 */
export function configureLogger(config: LoggerConfig | boolean): void {
  const loggerConfig: LoggerConfig =
    typeof config === 'boolean' ? { level: config ? 'info' : 'silent' } : config;

  currentConfig = loggerConfig;

  if (loggerInstance) {
    loggerInstance.configure(loggerConfig);
  } else {
    loggerInstance = new BrowserSafeLogger(loggerConfig);
  }
}

/**
 * Get the logger instance
 * @param context - Optional context for the logger (e.g., provider name)
 * @returns Logger instance
 */
export function getLogger(context?: string): BrowserSafeLogger {
  if (!loggerInstance) {
    // Initialize with environment variables or defaults
    const config: LoggerConfig = {
      level: (getLogLevelFromEnv() as LoggerConfig['level']) || 'silent',
      format: (getLogFormatFromEnv() as LoggerConfig['format']) || 'pretty',
    };
    currentConfig = config;
    loggerInstance = new BrowserSafeLogger(config);
  }

  if (context) {
    return loggerInstance.child({ context });
  }

  return loggerInstance;
}

/**
 * Reset the logger (mainly for testing)
 */
export function resetLogger(): void {
  loggerInstance = null;
  currentConfig = { level: 'silent' };
}

/**
 * Utility function to check if logging is enabled at a specific level
 */
export function isLogLevelEnabled(level: LoggerConfig['level']): boolean {
  if (!level) return false;
  if (currentConfig.level === 'silent') return false;
  if (level === 'silent') return true;
  return LEVELS[level] <= LEVELS[currentConfig.level || 'silent'];
}

// Export types for convenience
export type Logger = BrowserSafeLogger;
// For Winston compatibility
export type { BrowserSafeLogger as WinstonLogger };
