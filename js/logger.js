/**
 * js/logger.js — Frontend Logger for Event Genix
 * v20.12.0: Structured logging with level control
 *
 * Usage:
 *   FrontendLogger.debug('msg');
 *   FrontendLogger.info('msg');
 *   FrontendLogger.warn('msg');
 *   FrontendLogger.error('msg');
 *
 * Set log level via localStorage:
 *   localStorage.setItem('pzp_log_level', 'debug'); // debug|info|warn|error|off
 */
window.FrontendLogger = (() => {
    const LEVELS = { debug: 0, info: 1, warn: 2, error: 3, off: 4 };

    function _getLevel() {
        const stored = localStorage.getItem('pzp_log_level') || 'warn';
        return LEVELS[stored] ?? LEVELS.warn;
    }

    function _log(level, method, args) {
        if (LEVELS[level] >= _getLevel()) {
            console[method](`[${level.toUpperCase()}]`, ...args);
        }
    }

    return {
        debug(...args) { _log('debug', 'log', args); },
        info(...args)  { _log('info', 'info', args); },
        warn(...args)  { _log('warn', 'warn', args); },
        error(...args) { _log('error', 'error', args); }
    };
})();
