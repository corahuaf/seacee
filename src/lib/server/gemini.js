import { GoogleGenAI } from '@google/genai';
import { GEMINI_API_KEY } from '$app/env/private';

export const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY || '' });
