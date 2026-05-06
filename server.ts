import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import dotenv from 'dotenv';
import PDFDocument from 'pdfkit';
import { randomUUID } from 'crypto';
import { OrchestratorService } from './src/services/orchestrator.service.js';
import { GeminiService } from './src/services/gemini.service.js';
import { appConfig } from './src/config/app.config.js';
dotenv.config();

const PORT = process.env.PORT || 3000;
const orchestrator = new OrchestratorService();
const geminiService = new GeminiService();

let lastReport: any = null;
const reportCache = new Map<string, any>();
const runHistory: any[] = [];

async function startServer() {
  const app = express();
  
  // Use a larger limit since screenshots can be somewhat large
  app.use(express.json({ limit: '10mb' }));

  // Models Endpoint
  app.get('/api/models', async (req, res) => {
    try {
      const models = await geminiService.getAvailableModels();
      res.json(models);
    } catch (error: any) {
      console.error('Models Error:', error);
      res.status(500).json({ error: error.message || 'Error fetching models' });
    }
  });

  // History Endpoints
  app.get('/api/history', (req, res) => {
    res.json(runHistory);
  });

  app.get('/api/history/:id', (req, res) => {
    const run = runHistory.find(h => h.id === req.params.id);
    if (!run) {
      return res.status(404).json({ error: 'History run not found' });
    }
    res.json(run);
  });

  // Demo Endpoint
  app.get('/api/demo-run', async (req, res) => {
    const url = appConfig.demoUrl;
    const model = appConfig.defaultModel;
    const cacheKey = `${url}_${model}`;
    const timestamp = new Date().toISOString();
    let reportData = null;
    let isCached = false;

    if (appConfig.cacheEnabled && reportCache.has(cacheKey)) {
      console.log(`Cache hit for demo: ${cacheKey}`);
      reportData = reportCache.get(cacheKey);
      isCached = true;
    } else {
      console.log(`Cache miss for demo: ${cacheKey}`);
      try {
        reportData = await orchestrator.runQaAudit(url, model);
        if (appConfig.cacheEnabled) {
          reportCache.set(cacheKey, reportData);
        }
      } catch (error: any) {
        console.error('QA Error:', error);
        return res.status(500).json({ error: error.message || 'An error occurred during the QA process' });
      }
    }

    const runId = randomUUID();
    const historyEntry = {
      id: runId,
      url,
      model,
      timestamp,
      report: reportData
    };
    
    runHistory.unshift(historyEntry);
    lastReport = reportData;
    
    res.json({ ...reportData, cached: isCached, id: runId, timestamp });
  });

  // Explain Issue Endpoint
  app.post('/api/explain-issue', async (req, res) => {
    const { issue, model } = req.body;
    if (!issue) {
      return res.status(400).json({ error: 'Issue is required' });
    }

    try {
      const explanation = await gemini.explainIssue(issue, model);
      res.json(explanation);
    } catch (error: any) {
      console.error('Explain Issue Error:', error);
      res.status(500).json({ error: error.message || 'An error occurred during the explanation.' });
    }
  });

  // QA Endpoint
  app.post('/api/qa', async (req, res) => {
    const { url, model, forceRefresh } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const cacheKey = `${url}_${model || 'default'}`;
    const timestamp = new Date().toISOString();
    let reportData = null;
    let isCached = false;

    if (appConfig.cacheEnabled && !forceRefresh && reportCache.has(cacheKey)) {
      console.log(`Cache hit for ${cacheKey}`);
      reportData = reportCache.get(cacheKey);
      isCached = true;
    } else {
      console.log(`Cache miss for ${cacheKey}`);
      try {
        reportData = await orchestrator.runQaAudit(url, model);
        if (appConfig.cacheEnabled) {
          reportCache.set(cacheKey, reportData);
        }
      } catch (error: any) {
        console.error('QA Error:', error);
        return res.status(500).json({ error: error.message || 'An error occurred during the QA process' });
      }
    }

    const runId = randomUUID();
    const historyEntry = {
      id: runId,
      url,
      model: model || 'default',
      timestamp,
      report: reportData
    };
    
    runHistory.unshift(historyEntry);
    lastReport = reportData;
    
    res.json({ ...reportData, cached: isCached, id: runId, timestamp });
  });

  // Download Output Endpoint
  app.get('/api/qa/download', (req, res) => {
    if (!lastReport) {
      return res.status(404).json({ error: 'No report available for download' });
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="qa-report.json"');
    res.send(JSON.stringify(lastReport, null, 2));
  });

  // Export PDF Endpoint
  app.post('/api/qa/export-pdf', async (req, res) => {
    try {
      const report = req.body;
      if (!report || !report.url) {
        return res.status(400).json({ error: 'Report data is required' });
      }

      const doc = new PDFDocument({ margin: 50 });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="qa-report.pdf"');
      
      doc.pipe(res);

      // Title
      doc.fontSize(24).font('Helvetica-Bold').text('AI QA Report', { align: 'center' });
      doc.moveDown();

      // Main details
      doc.fontSize(12).font('Helvetica');
      doc.text(`URL: ${report.url}`);
      doc.text(`Pages Tested: ${report.pages_tested}`);
      doc.text(`Total Issues: ${report.total_issues}`);
      doc.text(`Score: ${report.score}/100`);
      doc.moveDown();

      // Summary
      doc.fontSize(14).font('Helvetica-Bold').text('Summary');
      doc.fontSize(12).font('Helvetica').text(report.summary || 'No summary available.');
      doc.moveDown();

      // Issue Summary
      if (report.issue_summary) {
        doc.fontSize(14).font('Helvetica-Bold').text('Issue Summary');
        doc.fontSize(12).font('Helvetica');
        doc.text(`UI: ${report.issue_summary.UI || 0}`);
        doc.text(`Functional: ${report.issue_summary.Functional || 0}`);
        doc.text(`Layout: ${report.issue_summary.Layout || 0}`);
        doc.text(`Accessibility: ${report.issue_summary.Accessibility || 0}`);
        doc.moveDown();
      }

      // Per-page issues
      if (report.pages && report.pages.length > 0) {
        doc.addPage();
        doc.fontSize(18).font('Helvetica-Bold').text('Per-Page Details');
        doc.moveDown();

        report.pages.forEach((page: any, index: number) => {
          doc.fontSize(14).font('Helvetica-Bold').text(`Page ${index + 1}: ${page.url}`);
          doc.moveDown(0.5);

          if (page.issues && page.issues.length > 0) {
            page.issues.forEach((issue: any) => {
              doc.fontSize(12).font('Helvetica-Bold').text(`[${(issue.severity || 'UNKNOWN').toUpperCase()}] ${issue.title || 'Untitled Issue'}`);
              doc.fontSize(10).font('Helvetica').text(`Description: ${issue.description || 'No description'}`);
              if (issue.suggestion) {
                 doc.text(`Suggestion: ${issue.suggestion}`);
              }
              doc.moveDown(0.5);
            });
          } else {
            doc.fontSize(10).font('Helvetica-Oblique').text('No issues found or analysis failed/skipped.');
          }
          doc.moveDown();
        });
      }

      doc.end();
      
    } catch (error: any) {
      console.error('PDF Export Error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: error.message || 'Error generating PDF' });
      }
    }
  });

  // Vite Integration for dev & prod
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
