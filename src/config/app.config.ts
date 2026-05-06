export const appConfig = {
  maxPagesToCrawl: process.env.MAX_PAGES_TO_CRAWL ? parseInt(process.env.MAX_PAGES_TO_CRAWL, 10) : 5,
  maxParallelRequests: process.env.MAX_PARALLEL_REQUESTS ? parseInt(process.env.MAX_PARALLEL_REQUESTS, 10) : 3,
  geminiRetryCount: process.env.GEMINI_RETRY_COUNT ? parseInt(process.env.GEMINI_RETRY_COUNT, 10) : 2,
  retryDelayMs: process.env.RETRY_DELAY_MS ? parseInt(process.env.RETRY_DELAY_MS, 10) : 1500,
  cacheEnabled: process.env.CACHE_ENABLED ? process.env.CACHE_ENABLED === 'true' : true,
  defaultModel: process.env.DEFAULT_MODEL || 'gemini-1.5-flash',
  demoUrl: process.env.DEMO_URL || 'https://example.com',
};
