import { PlaywrightService } from './playwright.service.js';
import { GeminiService } from './gemini.service.js';
import { QaReport, PageReport } from '../types.js';
import { appConfig } from '../config/app.config.js';

export class OrchestratorService {
  private playwrightService: PlaywrightService;
  private geminiService: GeminiService;

  constructor() {
    this.playwrightService = new PlaywrightService();
    this.geminiService = new GeminiService();
  }

  async runQaAudit(startUrl: string, modelName?: string): Promise<QaReport> {
    console.log(`Starting multi-page QA audit for: ${startUrl}`);
    const logs: string[] = [];
    logs.push(`Starting crawl...`);
    
    // 1. Capture Screenshots
    const capturedPages = await this.playwrightService.captureMultiplePages(startUrl, appConfig.maxPagesToCrawl);

    capturedPages.forEach((page, idx) => {
      logs.push(`Page ${idx + 1} visited: ${page.url}`);
    });

    logs.push(`Sending ${capturedPages.length} pages to Gemini for analysis...`);

    // 2. Analyze with Gemini (Max 3 parallel requests)
    const pageReports: PageReport[] = new Array(capturedPages.length);
    let currentIndex = 0;

    const worker = async () => {
      while (currentIndex < capturedPages.length) {
        const index = currentIndex++;
        const page = capturedPages[index];
        console.log(`Analyzing: ${page.url}`);
        logs.push(`Analyzing page ${index + 1}: ${page.url}`);
        let attempt = 0;
        let success = false;
        
        while (attempt <= appConfig.geminiRetryCount && !success) {
          try {
            if (attempt > 0) {
              logs.push(`Retry ${attempt} for page ${index + 1}`);
              console.log(`Retry ${attempt} for page ${index + 1}`);
              await new Promise(resolve => setTimeout(resolve, appConfig.retryDelayMs));
            }
            
            const analysis = await this.geminiService.analyzeScreenshot(page.screenshot, modelName);
            
            const a11yIssuesMapped = (page.accessibilityIssues || []).map(a11y => ({
              title: a11y.type,
              description: a11y.description,
              severity: a11y.severity as "High" | "Medium" | "Low",
              suggestion: "Review accessibility standards for this element."
            }));

            pageReports[index] = {
              url: page.url,
              issues: [...(analysis.issues || []), ...a11yIssuesMapped],
              screenshot: `data:image/png;base64,${page.screenshot.toString('base64')}`
            };
            logs.push(`Analysis complete for page ${index + 1}.`);
            success = true;
          } catch (error) {
            console.error(`Attempt ${attempt + 1} failed for ${page.url}:`, error);
            attempt++;
          }
        }

        if (!success) {
          console.error(`Gemini failed for page ${index + 1} after retries`);
          
          const a11yIssuesMapped = (page.accessibilityIssues || []).map(a11y => ({
            title: a11y.type,
            description: a11y.description,
            severity: a11y.severity as "High" | "Medium" | "Low",
            suggestion: "Review accessibility standards for this element."
          }));

          pageReports[index] = {
            url: page.url,
            issues: a11yIssuesMapped, // Continue even if all retries fail, keeping a11y
            screenshot: `data:image/png;base64,${page.screenshot.toString('base64')}`
          };
          logs.push(`Gemini failed for page ${index + 1} after retries`);
        }
      }
    };

    const CONCURRENCY_LIMIT = appConfig.maxParallelRequests;
    const workers = Array.from({ length: Math.min(CONCURRENCY_LIMIT, capturedPages.length) }, () => worker());
    await Promise.all(workers);

    logs.push(`Analysis complete for all ${capturedPages.length} pages.`);

    // Calculate and Aggregate Results
    let totalIssues = 0;
    let score = 100;
    const issue_summary = {
      UI: 0,
      Functional: 0,
      Layout: 0,
      Accessibility: 0
    };

    for (const report of pageReports) {
      if (!report) continue; // Safety check
      const issues = report.issues || [];
      totalIssues += issues.length;

      // Deduct points based on severity
      for (const issue of issues) {
        const severity = (issue.severity || '').toLowerCase();
        if (severity === 'high') {
          score -= 10;
        } else if (severity === 'medium') {
          score -= 5;
        } else if (severity === 'low') {
          score -= 2;
        }

        const titleLower = (issue.title || '').toLowerCase();
        if (titleLower.includes('func')) {
          issue_summary.Functional++;
        } else if (titleLower.includes('layout') || titleLower.includes('align')) {
          issue_summary.Layout++;
        } else if (titleLower.includes('access')) {
          issue_summary.Accessibility++;
        } else {
          // Default to UI for everything else
          issue_summary.UI++;
        }
      }
    }
    
    // Ensure score does not go below 0
    score = Math.max(0, score);
    
    // Determine summary
    let summary = '';
    if (score >= 90) {
      summary = 'Excellent quality, minimal issues';
    } else if (score >= 70) {
      summary = 'Moderate issues detected';
    } else {
      summary = 'Significant issues found';
    }
    
    return {
      url: startUrl,
      pages_tested: capturedPages.length,
      total_issues: totalIssues,
      score,
      summary,
      logs,
      issue_summary,
      pages: pageReports
    };
  }
}
