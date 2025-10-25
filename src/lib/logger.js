const LOG_ENDPOINT = 'http://localhost:17000/log';

class Logger {
  constructor() {
    this.logs = [];
    this.maxLogs = 1000;
  }

  async log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message: typeof message === 'object' ? JSON.stringify(message) : String(message)
    };

    this.logs.push(logEntry);
    
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    console.log(`[${timestamp}] [${level}] ${logEntry.message}`);

    try {
      await fetch(LOG_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(logEntry)
      }).catch(() => {});
    } catch (error) {
    }
  }

  info(message) {
    return this.log(message, 'INFO');
  }

  warn(message) {
    return this.log(message, 'WARN');
  }

  error(message) {
    return this.log(message, 'ERROR');
  }

  debug(message) {
    return this.log(message, 'DEBUG');
  }

  getLogs() {
    return this.logs;
  }
}

export const logger = new Logger();

