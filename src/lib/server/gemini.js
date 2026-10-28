import { GoogleGenAI } from '@google/genai';
import { GEMINI_API_KEY } from '$app/env/private';

const apiKey = (GEMINI_API_KEY || '')
	.trim()
	.replace(/^["']|["']$/g, '')
	.trim();

export const ai = new GoogleGenAI({ apiKey: apiKey || 'placeholder' });
