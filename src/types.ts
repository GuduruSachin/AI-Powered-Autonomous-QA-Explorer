export interface Issue {
  title: string;
  description: string;
  severity: 'High' | 'Medium' | 'Low';
  suggestion: string;
}

export interface GeminiAnalysisResult {
  issues: Issue[];
}

export interface PageReport {
  url: string;
  issues: Issue[];
  screenshot?: string;
}

export interface IssueSummary {
  UI: number;
  Functional: number;
  Layout: number;
  Accessibility: number;
}

export interface QaReport {
  url: string;
  pages_tested: number;
  total_issues: number;
  score: number;
  summary: string;
  logs: string[];
  issue_summary: IssueSummary;
  pages: PageReport[];
  cached?: boolean;
  id?: string;
  timestamp?: string;
}

export interface HistoryRun {
  id: string;
  url: string;
  model: string;
  timestamp: string;
  report: QaReport;
}
