import { GoogleGenAI } from '@google/genai';
import { GeminiAnalysisResult } from '../types.js';
import { appConfig } from '../config/app.config.js';

export class GeminiService {
  private ai: GoogleGenAI | null = null;
  private cachedModels: { models: { name: string, latency: number }[], default: string } | null = null;
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

  async getAvailableModels(): Promise<{ models: { name: string, latency: number }[], default: string }> {
    if (this.cachedModels && Date.now() - this.cacheTimestamp < 10 * 60 * 1000) {
      return this.cachedModels;
    }

    try {
      const aiClient = this.getClient();
      const response = await aiClient.models.list();
      
      let fetchedModels: any[] = [];
      for await (const m of response) {
        fetchedModels.push(m);
      }

      // Filter only models that support generateContent and are not deprecated/experimental
      const rawCandidates = fetchedModels.filter(m => {
        const name = (m.name || '').toLowerCase();
        const methods = m.supportedGenerationMethods || [];
        const isExp = name.includes('exp') || name.includes('preview');
        // Do NOT rely on name matching like "gemini-1.5"
        return methods.includes('generateContent') && !isExp;
      });

      // Prioritize models that likely support images (multimodal)
      rawCandidates.sort((a, b) => {
         const descA = (a.description || a.displayName || a.name || '').toLowerCase();
         const descB = (b.description || b.displayName || b.name || '').toLowerCase();
         
         const scoreA = (descA.includes('vision') || descA.includes('image') || descA.includes('multimodal')) ? 1 : 0;
         const scoreB = (descB.includes('vision') || descB.includes('image') || descB.includes('multimodal')) ? 1 : 0;
         
         if (scoreA !== scoreB) {
           return scoreB - scoreA;
         }
         
         // Fallback alphabetical sort descending (newer models like 2.x often come before 1.x or legacy in descending sort)
         return (b.name || '').localeCompare(a.name || '');
      });

      // Extract unique model names while preserving priority order
      const uniqueCandidates = [...new Set(rawCandidates.map(m => m.name))];

      // Limit validation load to first 6 top priority candidates
      const candidatesToTest = uniqueCandidates.slice(0, 6);

      // Tiny invisible transparent PNG to validate multimodal capability securely
      const tinyImageBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

      // Validate and compute latency for each model concurrently (No mutating array inside map)
      const validationResults = await Promise.all(candidatesToTest.map(async (modelName) => {
        const startTime = Date.now();
        try {
          // lightweight call to generateContent with an image to verify multimodal support
          const testRes = await aiClient.models.generateContent({
             model: modelName,
             contents: [
               {
                 role: 'user',
                 parts: [
                   { text: "Reply 'OK'" },
                   { inlineData: { mimeType: 'image/png', data: tinyImageBase64 } }
                 ]
               }
             ],
             config: { maxOutputTokens: 1, temperature: 0 }
          });
          if (testRes && testRes.text) {
             const latency = Date.now() - startTime;
             return { name: modelName, latency };
          }
        } catch (e) {
          // Validation failed or model doesn't support multimodal
          console.warn(`Model ${modelName} failed validation:`, e);
        }
        return null;
      }));

      const validModels = validationResults.filter((r): r is { name: string, latency: number } => r !== null);

      if (validModels.length > 0) {
        // Sort by latency DESC (slowest first for highest quality)
        validModels.sort((a, b) => b.latency - a.latency);
        
        let bestDefault = validModels[0];
        
        // Select best balanced model (slowest that is under 3000ms if possible)
        const balancedModels = validModels.filter(m => m.latency < 3000);
        if (balancedModels.length > 0) {
           bestDefault = balancedModels[0]; // Takes the slowest among those under 3000ms
        }

        this.cachedModels = {
          models: validModels,
          default: bestDefault.name
        };
        this.cacheTimestamp = Date.now();
        return this.cachedModels;
      }

      throw new Error("No valid Gemini models available for this API key");
    } catch (error) {
      console.warn('Failed to fetch/validate models:', error);
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
    } catch (error) {
      console.warn(`[${operationName}] Model ${selectedModel} failed:`, error);
      
      console.log(`[${operationName}] Getting available models for fallback...`);
      const { models } = await this.getAvailableModels();
      
      const fallbackModels = models
        .map(m => m.name)
        .filter(m => m !== selectedModel);
      
      for (const fallbackModel of fallbackModels) {
        try {
          console.log(`[${operationName}] Attempting fallback with model: ${fallbackModel}`);
          const result = await operation(fallbackModel);
          return result;
        } catch (fallbackError) {
          console.warn(`[${operationName}] Fallback model ${fallbackModel} failed:`, fallbackError);
        }
      }
      
      throw new Error("No valid Gemini models available for this API key");
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
