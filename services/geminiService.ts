import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { ChatMessage } from "../types";

// Initialize Gemini Client
// In a production environment, you should never expose API keys on the client side.
// This is for demonstration purposes within the constraints of the prompt.
const apiKey = process.env.API_KEY || ''; 
const ai = new GoogleGenAI({ apiKey });

const MODEL_NAME = 'gemini-3-flash-preview';

export const generateMeetingSummary = async (messages: ChatMessage[]): Promise<string> => {
  if (!apiKey) return "API Key not configured.";

  const transcript = messages
    .filter(m => !m.isSystem)
    .map(m => `${m.senderName}: ${m.text}`)
    .join('\n');

  const prompt = `
    You are an expert meeting secretary. 
    Please provide a concise summary of the following meeting chat transcript. 
    Highlight key decisions and action items if any.
    
    Transcript:
    ${transcript}
  `;

  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
    });
    return response.text || "Could not generate summary.";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Error connecting to AI Assistant.";
  }
};

export const askAiAssistant = async (query: string, contextMessages: ChatMessage[]): Promise<string> => {
    if (!apiKey) return "API Key not configured.";
  
    const recentContext = contextMessages
      .slice(-10)
      .filter(m => !m.isSystem)
      .map(m => `${m.senderName}: ${m.text}`)
      .join('\n');
  
    const prompt = `
      You are a helpful AI assistant in a video conference meeting.
      
      Context from recent chat:
      ${recentContext}
      
      User Question: ${query}
      
      Answer concisely and helpfully.
    `;
  
    try {
      const response: GenerateContentResponse = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: prompt,
      });
      return response.text || "I didn't understand that.";
    } catch (error) {
      console.error("Gemini Error:", error);
      return "I'm having trouble thinking right now.";
    }
  };
