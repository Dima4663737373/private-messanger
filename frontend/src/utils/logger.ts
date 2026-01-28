const isDev = import.meta.env.DEV;

export const logger = {
  // Production - always show
  error: (...args: any[]) => console.error(...args),
  warn: (...args: any[]) => console.warn(...args),
  
  // Development only
  info: (...args: any[]) => {
    if (isDev) console.log(...args);
  },
  debug: (...args: any[]) => {
    if (isDev) console.debug(...args);
  },
  
  // Groups (DEV only)
  group: (label: string) => {
    if (isDev) console.group(label);
  },
  groupEnd: () => {
    if (isDev) console.groupEnd();
  }
};
