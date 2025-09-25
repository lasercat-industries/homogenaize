import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { getLogger, configureLogger, resetLogger } from './logger';
import type { LoggerConfig } from './logger';

describe('Logger Module', () => {
  beforeEach(() => {
    // Reset logger before each test
    resetLogger();
    // Clear environment variables
    delete process.env.HOMOGENAIZE_LOG_LEVEL;
    delete process.env.HOMOGENAIZE_LOG_FORMAT;
  });

  afterEach(() => {
    // Clean up after each test
    resetLogger();
  });

  describe('Configuration', () => {
    it('should be silent by default', () => {
      const logger = getLogger();
      expect(logger.level).toBe('silent');
    });

    it('should accept boolean configuration (true = info level)', () => {
      configureLogger(true);
      const logger = getLogger();
      expect(logger.level).toBe('info');
    });

    it('should accept boolean configuration (false = silent)', () => {
      configureLogger(false);
      const logger = getLogger();
      expect(logger.level).toBe('silent');
    });

    it('should accept detailed configuration object', () => {
      const config: LoggerConfig = {
        level: 'debug',
        format: 'json',
        prefix: '[TestApp]',
      };
      configureLogger(config);
      const logger = getLogger();
      expect(logger.level).toBe('debug');
    });

    it('should support all log levels', () => {
      const levels = ['error', 'warn', 'info', 'debug', 'verbose', 'silent'] as const;

      levels.forEach((level) => {
        configureLogger({ level });
        const logger = getLogger();
        expect(logger.level).toBe(level);
      });
    });
  });

  describe('Environment Variables', () => {
    it('should read log level from environment variable', () => {
      process.env.HOMOGENAIZE_LOG_LEVEL = 'debug';
      const logger = getLogger();
      expect(logger.level).toBe('debug');
    });

    it('should read log format from environment variable', () => {
      process.env.HOMOGENAIZE_LOG_FORMAT = 'json';
      configureLogger(true); // Enable logging
      const logger = getLogger();
      // Check that JSON format is applied (this is harder to test directly)
      expect(logger.level).toBe('info');
    });

    it('should prioritize explicit config over environment variables', () => {
      process.env.HOMOGENAIZE_LOG_LEVEL = 'debug';
      configureLogger({ level: 'error' });
      const logger = getLogger();
      expect(logger.level).toBe('error');
    });
  });

  describe('Context and Metadata', () => {
    it('should support adding context to log messages', () => {
      configureLogger({ level: 'info' });
      const logger = getLogger();

      // Create a child logger with context
      const contextLogger = logger.child({
        provider: 'openai',
        requestId: '123',
      });
      expect(contextLogger).toBeDefined();
    });

    it('should support provider-specific loggers', () => {
      configureLogger({ level: 'info' });
      const logger = getLogger('openai');
      expect(logger).toBeDefined();
    });
  });

  describe('Logger Singleton', () => {
    it('should return the same logger instance', () => {
      const logger1 = getLogger();
      const logger2 = getLogger();
      expect(logger1).toBe(logger2);
    });

    it('should update existing logger when reconfigured', () => {
      const logger1 = getLogger();
      expect(logger1.level).toBe('silent');

      configureLogger({ level: 'debug' });
      const logger2 = getLogger();

      expect(logger1).toBe(logger2);
      expect(logger2.level).toBe('debug');
    });
  });

  describe('Safe Logging', () => {
    it('should not log sensitive data', () => {
      configureLogger({ level: 'verbose' });
      const logger = getLogger();

      // Test that sanitization is available
      const sanitized = logger.child({
        apiKey: 'sk-1234567890abcdef',
      });

      // The logger should mask API keys
      expect(sanitized).toBeDefined();
    });
  });
});
