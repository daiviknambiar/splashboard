import { GoogleGenerativeAI } from '@google/generative-ai';
import { VisualDescriptors } from '@/types';

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

export interface AnalyzeOptions {
  apiKey?: string;
}

const DESCRIPTOR_SCHEMA = `{
  "locationType": "e.g. 'cafe interior', 'coastal cliff', 'urban canyon', 'forest path'",
  "lightingConditions": "e.g. 'golden hour', 'overcast diffused', 'warm tungsten', 'blue hour'",
  "colorPalette": "e.g. 'muted earth tones', 'high contrast monochrome', 'warm amber and brown'",
  "mood": "e.g. 'serene and contemplative', 'bustling urban energy', 'intimate and quiet'",
  "framing": "e.g. 'wide establishing shot', 'tight portrait', 'overhead flat lay', 'eye-level medium'",
  "architectureStyle": "e.g. 'brutalist concrete', 'rustic wood', 'modern glass' — or null",
  "searchTerms": ["3 short searchable phrases combining the attributes above"]
}`;

const TEXT_PROMPT = (description: string) => `You are an expert photography curator. Extract structured visual search descriptors from this concept.

Concept: "${description}"

Return ONLY valid JSON with this exact schema — no markdown, no explanation, no extra keys:
${DESCRIPTOR_SCHEMA}

Rules:
- searchTerms must be concrete and directly searchable on a stock photo platform
- Each search term combines 2–3 descriptors for specificity (e.g. "overcast coastal cliffs muted gray")
- Focus on visually searchable attributes, not abstract concepts
- Keep values concise (3–6 words each)`;

const IMAGE_PROMPT = `You are an expert photography curator. Analyze this photograph and extract its visual characteristics as structured search descriptors.

Return ONLY valid JSON with this exact schema — no markdown, no explanation, no extra keys:
${DESCRIPTOR_SCHEMA}

Rules:
- Extract only what you can visually observe in the image
- Do NOT identify specific people, locations, or brands
- searchTerms must be concrete and directly searchable on a stock photo platform
- Each search term combines 2–3 descriptors (e.g. "warm tungsten cafe interior")
- Keep values concise (3–6 words each)
- architectureStyle is null if not applicable`;

export async function analyzeImage(
  base64Image: string,
  mimeType: string,
  options?: AnalyzeOptions
): Promise<VisualDescriptors> {
  const model = getModel(options);
  const result = await model.generateContent([
    IMAGE_PROMPT,
    { inlineData: { data: base64Image, mimeType } },
  ]);
  return parseDescriptors(result.response.text());
}

export async function analyzeText(
  description: string,
  options?: AnalyzeOptions
): Promise<VisualDescriptors> {
  const model = getModel(options);
  const result = await model.generateContent(TEXT_PROMPT(description));
  return parseDescriptors(result.response.text());
}

function parseDescriptors(raw: string): VisualDescriptors {
  const cleaned = raw
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();

  const parsed = JSON.parse(cleaned);

  if (!parsed.locationType || !parsed.searchTerms || !Array.isArray(parsed.searchTerms)) {
    throw new Error('Incomplete descriptor structure returned by model');
  }

  return parsed as VisualDescriptors;
}

function getModel(options?: AnalyzeOptions) {
  const resolvedApiKey = options?.apiKey?.trim() || process.env.GEMINI_API_KEY;
  if (!resolvedApiKey) {
    throw new Error('Gemini API key is not configured');
  }

  const genAI = new GoogleGenerativeAI(resolvedApiKey);
  return genAI.getGenerativeModel({ model: GEMINI_MODEL });
}
