import winston from 'winston';
import type { Logger as WinstonLogger } from 'winston';
import BrowserConsole from 'winston-transport-browserconsole';

function getLogLevelFromEnv() {
  return process !== undefined
    ? process.env.HOMOGENAIZE_LOG_LEVEL
    : import.meta.env.HOMOGENAIZE_LOG_LEVEL || import.meta.env.VITE_HOMOGENAIZE_LOG_LEVEL;
}

function getLogFormatFromEnv() {
  return process !== undefined
    ? process.env.HOMOGENAIZE_LOG_FORMAT
    : import.meta.env.HOMOGENAIZE_LOG_FORMAT || import.meta.env.VITE_HOMOGENAIZE_LOG_FORMAT;
}

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
  /** Custom Winston transports */
  transports?: winston.transport[];
}

// Custom silent level
const CUSTOM_LEVELS = {
  levels: {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
    verbose: 4,
    silent: 5,
  },
  colors: {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    debug: 'blue',
    verbose: 'cyan',
    silent: 'grey',
  },
};

// Singleton logger instance
let loggerInstance: WinstonLogger | null = null;
let currentConfig: LoggerConfig = { level: 'silent' };

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

/**
 * Creates a Winston format based on configuration
 */
function createFormat(config: LoggerConfig): winston.Logform.Format {
  const formats: winston.Logform.Format[] = [winston.format.timestamp()];

  // Add prefix if provided
  if (config.prefix) {
    formats.push(
      winston.format((info) => {
        info.message = `${config.prefix} ${info.message}`;
        return info;
      })(),
    );
  }

  // Add sanitization
  formats.push(
    winston.format((info) => {
      info.message = sanitizeData(info.message);
      if (info.metadata) {
        info.metadata = sanitizeData(info.metadata);
      }
      return info;
    })(),
  );

  // Apply format based on configuration
  if (config.format === 'json') {
    formats.push(winston.format.json());
  } else {
    formats.push(
      winston.format.colorize(),
      winston.format.simple(),
      winston.format.printf(({ level, message, timestamp, ...metadata }) => {
        let msg = `${timestamp} [${level}]: ${message}`;
        if (Object.keys(metadata).length > 0) {
          msg += ` ${JSON.stringify(metadata)}`;
        }
        return msg;
      }),
    );
  }

  return winston.format.combine(...formats);
}

/**
 * Creates or updates the logger instance
 */
function createLogger(config: LoggerConfig): WinstonLogger {
  // Get configuration from environment variables if not explicitly set
  const level = config.level || (getLogLevelFromEnv() as LoggerConfig['level']) || 'silent';

  const format = config.format || (getLogFormatFromEnv() as LoggerConfig['format']) || 'pretty';

  const finalConfig: LoggerConfig = {
    ...config,
    level,
    format,
  };

  // Store current configuration
  currentConfig = finalConfig;

  // Handle silent level by not adding any transports
  let transports: winston.transport[] = config.transports || [];

  if (level === 'silent') {
    transports = [];
  } else if (process === undefined) {
    transports = [
      new BrowserConsole({
        format: winston.format.simple(),
        level,
      }),
    ];
  } else if (!config.transports) {
    transports.push(
      new winston.transports.Console({
        level: level,
        silent: false,
      }),
    );
  }

  const logger = winston.createLogger({
    levels: CUSTOM_LEVELS.levels,
    level: level === 'silent' ? 'error' : level, // Winston doesn't have built-in silent
    format: createFormat(finalConfig),
    transports,
    silent: level === 'silent', // Disable all logging when silent
  });

  if (process !== undefined) {
    // Add colors for console output
    winston.addColors(CUSTOM_LEVELS.colors);
  }

  // Override level property for testing
  Object.defineProperty(logger, 'level', {
    get() {
      return currentConfig.level || 'silent';
    },
    set(value) {
      currentConfig.level = value;
      // Don't call configure to avoid infinite recursion
      // Just update the transports directly
      if (value === 'silent') {
        logger.silent = true;
      } else {
        logger.silent = false;
        logger.transports.forEach((transport) => {
          transport.level = value;
          transport.silent = false;
        });
      }
    },
    configurable: true,
  });

  return logger;
}

/**
 * Configure the global logger
 * @param config - Logger configuration or boolean (true = info, false = silent)
 */
export function configureLogger(config: LoggerConfig | boolean): void {
  const loggerConfig: LoggerConfig =
    typeof config === 'boolean' ? { level: config ? 'info' : 'silent' } : config;

  if (loggerInstance) {
    // Update existing logger
    const newLogger = createLogger(loggerConfig);
    Object.setPrototypeOf(loggerInstance, Object.getPrototypeOf(newLogger));
    Object.keys(newLogger).forEach((key) => {
      (loggerInstance as unknown as Record<string, unknown>)[key] = (
        newLogger as unknown as Record<string, unknown>
      )[key];
    });
  } else {
    loggerInstance = createLogger(loggerConfig);
  }
}

/**
 * Get the logger instance
 * @param context - Optional context for the logger (e.g., provider name)
 * @returns Winston logger instance
 */
export function getLogger(context?: string): WinstonLogger {
  if (!loggerInstance) {
    // Initialize with environment variables or defaults
    const config: LoggerConfig = {
      level: (getLogLevelFromEnv() as LoggerConfig['level']) || 'silent',
      format: (getLogFormatFromEnv() as LoggerConfig['format']) || 'pretty',
    };
    loggerInstance = createLogger(config);
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
  const levelValue = CUSTOM_LEVELS.levels[level || 'silent'];
  const currentLevelValue = CUSTOM_LEVELS.levels[currentConfig.level || 'silent'];
  return levelValue <= currentLevelValue;
}

// Export types for convenience
export type { WinstonLogger as Logger };
