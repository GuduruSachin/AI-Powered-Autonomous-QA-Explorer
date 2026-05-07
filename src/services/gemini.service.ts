import { GoogleGenAI } from '@google/genai';
import { GeminiAnalysisResult } from '../types.js';
import { appConfig } from '../config/app.config.js';

export class GeminiService {
  private ai: GoogleGenAI | null = null;
  private cachedModels: { models: { name: string, latency: number, source?: string }[], default: string } | null = null;
  private cacheTimestamp: number = 0;

  private getClient(): GoogleGenAI {
    if (!this.ai) {
      const key = process.env.GEMINI_API_KEY;
      if (!key) {
        throw new Error('GEMINI_API_KEY environment variable is required');
      }
      this.ai = new GoogleGenAI({ apiKey: key });
    }
    return this.ai;
  }

  async getAvailableModels(): Promise<{ models: { name: string, latency: number, source?: string }[], default: string }> {
    if (this.cachedModels && Date.now() - this.cacheTimestamp < 10 * 60 * 1000) {
      return this.cachedModels;
    }

    try {
      const key = process.env.GEMINI_API_KEY;
      if (!key) {
        throw new Error('GEMINI_API_KEY environment variable is required');
      }

      console.log("Fetching dynamic models via REST API...");
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      const fetchedModels = data.models || [];

      // Filter models that support generateContent and exclude experimental models
      let rawCandidates = fetchedModels.filter((m: any) => {
        const methods = m.supportedGenerationMethods || [];
        const name = (m.name || '').toLowerCase();
        const isExp = name.includes('exp') || name.includes('preview');
        return methods.includes('generateContent') && !isExp;
      });

      const uniqueCandidates = [...new Set(rawCandidates.map((m: any) => m.name))] as string[];
      
      const aiClient = this.getClient();
      console.log(`Testing latency for ${uniqueCandidates.length} models...`);

      // Test all models concurrently to measure latency
      const validationResults = await Promise.all(uniqueCandidates.map(async (modelName) => {
        const startTime = Date.now();
        try {
          const cleanModelName = modelName.replace('models/', '');
          const testRes = await aiClient.models.generateContent({
             model: cleanModelName,
             contents: "Hi",
             config: { maxOutputTokens: 1, temperature: 0 }
          });
          
          if (testRes && testRes.text) {
             const latency = Date.now() - startTime;
             return { name: cleanModelName, latency, source: 'API Verified' };
          }
        } catch (e: any) {
          console.warn(`Model ${modelName} failed validation:`, e.message || e);
        }
        return null;
      }));

      // Filter out failed models
      let validModels = validationResults.filter((r): r is { name: string, latency: number, source: string } => r !== null);

      if (validModels.length > 0) {
        // Sort by latency ASC (fastest first)
        validModels.sort((a, b) => a.latency - b.latency);
        
        // Take top 5 fastest working models
        validModels = validModels.slice(0, 5);
        
        // Default to the first (fastest) model
        const defaultModelName = validModels[0].name;

        console.log("Top working models found:", validModels.map(m => `${m.name} (${m.latency}ms)`).join(', '));

        this.cachedModels = {
          models: validModels,
          default: defaultModelName
        };
        this.cacheTimestamp = Date.now();
        return this.cachedModels;
      }
      
      throw new Error("No valid models responded successfully during latency testing.");
    } catch (error) {
      console.warn('Dynamic fetch and validation failed:', error);
      throw new Error("No valid Gemini models available for this API key");
    }
  }

  private async executeWithFallback<T>(
    selectedModel: string,
    operation: (modelName: string) => Promise<T>,
    operationName: string
  ): Promise<T> {
    try {
      console.log(`[${operationName}] Attempting with model: ${selectedModel}`);
      const result = await operation(selectedModel);
      return result;
    } catch (error: any) {
      console.warn(`[${operationName}] Model ${selectedModel} failed:`, error);
      
      // If the error is a 429 Resource Exhausted/Quota error, throw it immediately
      if (error && error.message && (error.message.includes('429') || error.message.toLowerCase().includes('quota') || error.message.toLowerCase().includes('exhausted'))) {
        throw new Error(`API Quota Exceeded: ${error.message}`);
      }
      
      console.log(`[${operationName}] Getting available models for fallback...`);
      let models = [];
      try {
        const result = await this.getAvailableModels();
        models = result.models;
      } catch (e: any) {
         if (e && e.message && (e.message.includes('429') || e.message.toLowerCase().includes('quota'))) {
            throw new Error(`API Quota Exceeded: ${e.message}`);
         }
         throw new Error(`No valid Gemini models available: ${e.message}`);
      }
      
      const fallbackModels = models
        .map(m => m.name)
        .filter(m => m !== selectedModel);
      
      let lastError: any = error;
      for (const fallbackModel of fallbackModels) {
        try {
          console.log(`[${operationName}] Attempting fallback with model: ${fallbackModel}`);
          const result = await operation(fallbackModel);
          return result;
        } catch (fallbackError: any) {
          lastError = fallbackError;
          console.warn(`[${operationName}] Fallback model ${fallbackModel} failed:`, fallbackError);
          // Stop trying variants if we hit a quota limit
          if (fallbackError && fallbackError.message && (fallbackError.message.includes('429') || fallbackError.message.toLowerCase().includes('quota'))) {
            throw new Error(`API Quota Exceeded during fallback: ${fallbackError.message}`);
          }
        }
      }
      
      throw new Error(`Execution failed. Last error: ${lastError?.message || 'No models available'}`);
    }
  }

  async explainIssue(issue: any, modelName?: string): Promise<{ explanation: string, fix_suggestion: string }> {
    let selectedModel = modelName || appConfig.defaultModel;

    const promptText = `You are a Senior QA Engineer and Frontend Developer.
Please explain the following UI/UX or functional issue in simple terms, and suggest a practical fix (with code examples if possible).

Issue Type: ${issue.type || 'Unknown'}
Severity: ${issue.severity}
Description: ${issue.description}

Provide your response in JSON format with exactly two properties: "explanation" and "fix_suggestion".`;

    try {
      const responseText = await this.executeWithFallback(
        selectedModel,
        async (mName) => {
          const aiClient = this.getClient();
          const response = await aiClient.models.generateContent({
            model: mName,
            contents: promptText,
            config: {
              responseMimeType: "application/json",
              temperature: 0.2, // Low temp for more factual fix
            }
          });
          return response.text || '{ "explanation": "Failed to generate explanation.", "fix_suggestion": "" }';
        },
        'explainIssue'
      );
      return JSON.parse(responseText);
    } catch (error) {
      console.error('Error explaining issue with Gemini:', error);
      throw error;
    }
  }

  async generateExecutiveSummary(data: any, modelName?: string): Promise<string> {
    let selectedModel = modelName || appConfig.defaultModel;

    const promptText = `You are a Senior QA Lead / Product Quality Analyst.
Please provide a concise executive summary (3-5 lines) of the following QA report in business-friendly (non-technical) language.
Focus on the overall quality, key risk areas, and top recommendations.

Report Data:
- Total Issues: ${data.total_issues}
- Overall Score: ${data.score}/100
- Issue Breakdown: UI (${data.issue_summary.UI}), Functional (${data.issue_summary.Functional}), Layout (${data.issue_summary.Layout}), Accessibility (${data.issue_summary.Accessibility})
- Top Issues:
${data.key_issues.map((i: any) => `  * [${i.severity}] ${i.title}: ${i.description}`).join('\n')}

Provide ONLY the summary text, no surrounding markdown formatting or additional explanation.`;

    try {
      const responseText = await this.executeWithFallback(
        selectedModel,
        async (mName) => {
          const aiClient = this.getClient();
          const response = await aiClient.models.generateContent({
            model: mName,
            contents: promptText,
            config: {
              temperature: 0.3, 
            }
          });
          return response.text || "Executive summary unavailable.";
        },
        'generateExecutiveSummary'
      );
      return responseText;
    } catch (error) {
      console.error('Error generating executive summary with Gemini:', error);
      return "Executive summary unavailable.";
    }
  }

  async analyzeScreenshot(screenshotBuffer: Buffer, modelName?: string): Promise<GeminiAnalysisResult> {
    console.log('Sending to Gemini for analysis...');
    let selectedModel = modelName || appConfig.defaultModel;

    const promptText = `You are a Senior QA Engineer.
Analyze this UI screenshot and detect:
- Broken buttons/links
- Missing text/images
- Overlapping elements
- Alignment/layout issues

Rules:
- Limit max 5 issues per page.
- Be deterministic and consistent.
- If no issues found, return: { "issues": [] }
- NO extra text, NO explanations. ONLY return valid JSON.

Expected format:
{
  "issues": [
    {
      "type": "UI | Functional | Layout",
      "description": "",
      "severity": "High | Medium | Low"
    }
  ]
}`;

    let responseText = '';
    
    try {
      responseText = await this.executeWithFallback(
        selectedModel,
        async (mName) => {
          const aiClient = this.getClient();
          const response = await aiClient.models.generateContent({
            model: mName,
            contents: [
              {
                role: 'user',
                parts: [
                  { text: promptText },
                  { inlineData: { mimeType: 'image/png', data: screenshotBuffer.toString('base64') } }
                ]
              }
            ],
            config: {
              responseMimeType: 'application/json',
              temperature: 0.1
            }
          });
          return response.text || '{ "issues": [] }';
        },
        'analyzeScreenshot'
      );
    } catch (error) {
      console.error('Failed to analyze screenshot, all models failed', error);
      // Let it fall through with empty issues array
      responseText = '{ "issues": [] }';
    }

    console.log('Received response from Gemini');
    
    try {
      // Parse the JSON safely
      const parsed = JSON.parse(responseText);
      
      // Map the required format back to our internal types
      const mappedIssues = (parsed.issues || []).map((issue: any) => ({
        title: issue.type || 'UI Issue',
        description: issue.description || 'Issue description unavailable.',
        severity: ['High', 'Medium', 'Low', 'high', 'medium', 'low'].includes(issue.severity) 
          ? (issue.severity.charAt(0).toUpperCase() + issue.severity.slice(1).toLowerCase()) as any 
          : 'Low',
        suggestion: 'Please review the element and adjust its styling or functionality.'
      }));

      return {
        issues: mappedIssues
      };
    } catch (error) {
      console.error('JSON Parse Error:', error);
      console.error('Raw text was:', responseText);
      return { issues: [] };
    }
  }
}
