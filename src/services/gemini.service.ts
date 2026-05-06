import { GoogleGenAI } from '@google/genai';
import { GeminiAnalysisResult } from '../types.js';
import { appConfig } from '../config/app.config.js';

export class GeminiService {
  private ai: GoogleGenAI | null = null;

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

  async getAvailableModels(): Promise<{ models: string[], default: string }> {
    const defaultModels = ['gemini-1.5-flash', 'gemini-1.5-pro'];
    const preferredDefault = appConfig.defaultModel;

    try {
      const aiClient = this.getClient();
      const response = await aiClient.models.list();
      
      let fetchedModels: string[] = [];
      for await (const m of response) {
        if (m.name) {
          fetchedModels.push(m.name.replace('models/', ''));
        }
      }

      // Filter only gemini models that support vision (1.5/2.x)
      const safeModels = fetchedModels.filter(name => 
        name.includes('gemini') && 
        (name.includes('1.5') || (name.includes('2.0') && !name.includes('gemini-2.0-flash-exp')) || name.includes('2.5'))
      );

      if (safeModels.length > 0) {
        return {
          models: safeModels,
          default: safeModels.includes(preferredDefault) ? preferredDefault : safeModels[0]
        };
      }
      return { models: defaultModels, default: preferredDefault };
    } catch (error) {
      console.warn('Failed to fetch models, using fallback list:', error);
      return { models: defaultModels, default: preferredDefault };
    }
  }

  async explainIssue(issue: any, modelName?: string): Promise<{ explanation: string, fix_suggestion: string }> {
    const aiClient = this.getClient();
    let selectedModel = modelName || appConfig.defaultModel;

    const promptText = `You are a Senior QA Engineer and Frontend Developer.
Please explain the following UI/UX or functional issue in simple terms, and suggest a practical fix (with code examples if possible).

Issue Type: ${issue.type || 'Unknown'}
Severity: ${issue.severity}
Description: ${issue.description}

Provide your response in JSON format with exactly two properties: "explanation" and "fix_suggestion".`;

    try {
      const response = await aiClient.models.generateContent({
        model: selectedModel,
        contents: promptText,
        config: {
          responseMimeType: "application/json",
          temperature: 0.2, // Low temp for more factual fix
        }
      });
      const responseText = response.text || '{ "explanation": "Failed to generate explanation.", "fix_suggestion": "" }';
      return JSON.parse(responseText);
    } catch (error) {
      console.error('Error explaining issue with Gemini:', error);
      throw error;
    }
  }

  async analyzeScreenshot(screenshotBuffer: Buffer, modelName?: string): Promise<GeminiAnalysisResult> {
    console.log('Sending to Gemini for analysis...');
    const aiClient = this.getClient();
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
      const response = await aiClient.models.generateContent({
        model: selectedModel,
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
      responseText = response.text || '{ "issues": [] }';
    } catch (error) {
      console.warn(`Model ${selectedModel} failed. Falling back to default model (${appConfig.defaultModel}). Error:`, error);
      console.log('Model fallback triggered');
      selectedModel = appConfig.defaultModel;
      // Attempt fallback safely
      const fallbackResponse = await aiClient.models.generateContent({
        model: selectedModel,
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
      responseText = fallbackResponse.text || '{ "issues": [] }';
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
