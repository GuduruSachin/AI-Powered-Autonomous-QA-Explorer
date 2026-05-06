import { chromium, Browser, Page } from 'playwright';
import { appConfig } from '../config/app.config.js';

export interface CapturedPage {
  url: string;
  screenshot: Buffer;
  accessibilityIssues: Array<{
    type: string;
    description: string;
    severity: string;
  }>;
}

export class PlaywrightService {
  async captureMultiplePages(startUrl: string, maxPages: number = appConfig.maxPagesToCrawl): Promise<CapturedPage[]> {
    let browser: Browser | null = null;
    const capturedPages: CapturedPage[] = [];
    const visitedUrls = new Set<string>();
    const toVisit = [startUrl];

    try {
      console.log(`Initializing Playwright...`);
      browser = await chromium.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] 
      });
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 }
      });
      const page = await context.newPage();
      
      const startUrlObj = new URL(startUrl);
      const baseDomain = startUrlObj.hostname;

      while (toVisit.length > 0 && capturedPages.length < maxPages) {
        const currentUrl = toVisit.shift()!;
        
        // Remove hash/query for deduplication
        const urlWithoutHashAndQuery = currentUrl.split('#')[0].split('?')[0].replace(/\/$/, "");
        
        if (visitedUrls.has(urlWithoutHashAndQuery)) {
          continue;
        }

        visitedUrls.add(urlWithoutHashAndQuery);

        console.log(`Navigating to ${currentUrl}... (${capturedPages.length + 1}/${maxPages})`);
        try {
          await page.goto(currentUrl, { waitUntil: 'load', timeout: 30000 });
          // wait a bit for animations or dynamic content
          await page.waitForTimeout(1000);
          
          console.log(`Evaluating accessibility for ${currentUrl}...`);
          const accessibilityIssues = await page.evaluate(() => {
            const issues: Array<{ type: string; description: string; severity: string }> = [];
            
            // Images without alt attribute
            const images = document.querySelectorAll('img:not([alt])');
            if (images.length > 0) {
              issues.push({
                type: "Accessibility",
                description: `Found ${images.length} image(s) missing 'alt' attribute`,
                severity: "Medium"
              });
            }

            // Buttons without accessible text
            const buttons = document.querySelectorAll('button');
            let badButtons = 0;
            for (let i = 0; i < buttons.length; i++) {
              const b = buttons[i];
              const textContent = b.textContent?.trim();
              const ariaLabel = b.getAttribute('aria-label')?.trim();
              const title = b.getAttribute('title')?.trim();
              if (!textContent && !ariaLabel && !title) {
                badButtons++;
              }
            }
            if (badButtons > 0) {
              issues.push({
                type: "Accessibility",
                description: `Found ${badButtons} button(s) without accessible text`,
                severity: "Medium"
              });
            }

            // Links without href or empty text
            const links = document.querySelectorAll('a');
            let badLinks = 0;
            for (let i = 0; i < links.length; i++) {
              const a = links[i];
              const href = a.getAttribute('href');
              const textContent = a.textContent?.trim();
              const ariaLabel = a.getAttribute('aria-label')?.trim();
              const title = a.getAttribute('title')?.trim();
              const hasImgAlt = a.querySelector('img[alt]');
              
              if (!href || href === '' || (!textContent && !ariaLabel && !title && !hasImgAlt)) {
                badLinks++;
              }
            }
            if (badLinks > 0) {
              issues.push({
                type: "Accessibility",
                description: `Found ${badLinks} link(s) without an 'href' or missing text`,
                severity: "Medium"
              });
            }

            return issues;
          });

          console.log(`Capturing screenshot for ${currentUrl}...`);
          const screenshotBuffer = await page.screenshot({ fullPage: true });
          
          capturedPages.push({
            url: page.url(), // Use final resolved URL
            screenshot: screenshotBuffer,
            accessibilityIssues
          });

          // Discover links on the page if we haven't reached maxPages yet
          if (capturedPages.length < maxPages) {
            const links = await page.evaluate(() => {
              const anchors = Array.from(document.querySelectorAll('a[href]'));
              return anchors.map(a => (a as HTMLAnchorElement).href);
            });

            for (const link of links) {
              try {
                const linkUrlObj = new URL(link);
                const normalizedLink = link.split('#')[0].split('?')[0].replace(/\/$/, "");
                
                // Rules: Same domain, avoid logout/delete, avoid purely hash links or pdfs
                if (linkUrlObj.hostname !== baseDomain) continue;
                
                const lowerLink = normalizedLink.toLowerCase();
                if (
                  lowerLink.includes('logout') || 
                  lowerLink.includes('signout') || 
                  lowerLink.includes('delete') ||
                  lowerLink.includes('remove') ||
                  lowerLink.endsWith('.pdf') ||
                  lowerLink.endsWith('.jpg') ||
                  lowerLink.endsWith('.png') ||
                  lowerLink.endsWith('.zip')
                ) {
                  continue;
                }

                if (!visitedUrls.has(normalizedLink) && !toVisit.includes(normalizedLink)) {
                  toVisit.push(normalizedLink);
                }
              } catch (e) {
                // Ignore invalid URLs
              }
            }
          }
        } catch (error) {
          console.error(`Failed to navigate/capture ${currentUrl}:`, error);
        }
      }
      
      return capturedPages;
    } finally {
      if (browser) {
        await browser.close().catch(console.error);
      }
    }
  }
}
