import { GoogleGenAI } from '@google/genai';
import { config } from 'dotenv';
config();

async function run() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const models = await ai.models.list();
  for await (const m of models) {
    if (m.name && m.name.includes('gemini') && m.supportedGenerationMethods?.includes('generateContent')) {
       console.log(m.name, m.version, m.description?.split('\n')[0]);
    }
  }
}
run();
