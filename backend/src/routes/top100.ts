import { Router } from "express";

export type Top100Entry = {
  rank: number;
  name: string;
  categoryEra: string;
  whyTheyMatter: string;
  historicalImpact: string;
  notableDetail: string;
  learnMore: string;
};

export type Top100Response = {
  category: string;
  count: number;
  atlas: string;
  entries: Top100Entry[];
};

const LIST_SYSTEM_PROMPT = `You are a structured reference-document generator. Your job is to produce a ranked list of the most influential people and entities within a given category.

Respond ONLY with valid JSON in this exact format (no markdown, no extra text):
{
  "entries": [
    {
      "rank": <integer starting at 1>,
      "name": "<full name or entity name>",
      "categoryEra": "<sub-category> | <era or century>",
      "whyTheyMatter": "<1-2 sentences: the core reason for their influence>",
      "historicalImpact": "<1-2 sentences: what changed because of them>",
      "notableDetail": "<1 sentence: a memorable or surprising specific fact>",
      "learnMore": "<a simple URL to Britannica, Encyclopedia.com, or a reputable institutional reference>"
    }
  ]
}

Ranking rules:
- Rank by depth of influence, not by popularity or fame
- Balance across sub-fields, eras, regions, and demographics
- Include non-person entities (institutions, movements, texts, technologies) where they clearly matter
- Do not skip ranks or duplicate entries
- Be concise but complete — do not let later entries become thinner than earlier ones`;

const ATLAS_SYSTEM_PROMPT = `You are a structured reference-document generator. Your job is to produce a polished educational Atlas of Influence for a given category.

Write a well-organized reference guide using this structure:

# Atlas of Influence: [Category]

## Introduction
A brief framing of the category and why it matters.

## Defining the Category
What counts as part of this category; scope and boundaries.

## Major Contributors
The key people and entities who shaped the field, grouped thematically.

## Key Ideas & Concepts
The core intellectual or creative contributions that define the category.

## Major Movements & Schools
Distinct movements, schools of thought, or traditions within the category.

## Turning Points
The pivotal moments, discoveries, or works that changed everything.

## Chains of Influence
How influence moved through the field — who learned from whom, what ideas built on others.

## Important Institutions
Organizations, universities, publications, or venues that shaped the field.

## Lasting Legacy
What endures today and why this category still matters.

Style rules:
- Write like a compact educational reference guide, not a blog post
- Use clear section headings, short paragraphs, easy-to-scan prose
- Be accurate, balanced, and concise
- Do not invent obscure facts or unverifiable influence chains`;

async function callOpenAI(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  jsonMode: boolean
): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    max_tokens: maxTokens,
    temperature: 0.4
  };

  if (jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "(no body)");
    throw new Error(`OpenAI API error ${response.status}: ${errorBody}`);
  }

  const data = await response.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content ?? "";
}

export const createTop100Router = (openaiApiKey: string | undefined, openaiModel: string) => {
  const router = Router();

  router.post("/top100/generate", async (req, res, next) => {
    try {
      const { category, count } = req.body as { category?: unknown; count?: unknown };

      if (!category || typeof category !== "string" || category.trim().length === 0) {
        return res.status(400).json({ error: "category is required" });
      }

      const clampedCount = Math.max(1, Math.min(100, Math.round(Number(count) || 25)));
      const cleanCategory = category.trim();

      if (!openaiApiKey) {
        return res.status(503).json({ error: "OpenAI API key is not configured on this server." });
      }

      const listUserPrompt = `Generate a ranked list of the top ${clampedCount} most influential people and entities in the category: "${cleanCategory}". Produce exactly ${clampedCount} entries, ranked from 1 to ${clampedCount}.`;
      const atlasUserPrompt = `Write an Atlas of Influence for the category: "${cleanCategory}".`;

      // Run both calls in parallel
      const listTokens = Math.min(16000, Math.max(2000, clampedCount * 180));
      const [listRaw, atlasRaw] = await Promise.all([
        callOpenAI(openaiApiKey, openaiModel, LIST_SYSTEM_PROMPT, listUserPrompt, listTokens, true),
        callOpenAI(openaiApiKey, openaiModel, ATLAS_SYSTEM_PROMPT, atlasUserPrompt, 3000, false)
      ]);

      let entries: Top100Entry[] = [];
      try {
        const parsed = JSON.parse(listRaw) as { entries?: unknown };
        if (Array.isArray(parsed.entries)) {
          const seenNames = new Set<string>();
          const raw = (parsed.entries as Record<string, unknown>[]).map((e, i) => ({
            rank: typeof e.rank === "number" ? e.rank : i + 1,
            name: typeof e.name === "string" ? e.name : "",
            categoryEra: typeof e.categoryEra === "string" ? e.categoryEra : "",
            whyTheyMatter: typeof e.whyTheyMatter === "string" ? e.whyTheyMatter : "",
            historicalImpact: typeof e.historicalImpact === "string" ? e.historicalImpact : "",
            notableDetail: typeof e.notableDetail === "string" ? e.notableDetail : "",
            learnMore: typeof e.learnMore === "string" ? e.learnMore : ""
          }));

          // Deduplicate by normalized name, then re-number ranks sequentially
          const deduped = raw.filter((e) => {
            if (!e.name) return false;
            const key = e.name.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
            if (seenNames.has(key)) return false;
            seenNames.add(key);
            return true;
          });
          entries = deduped.map((e, i) => ({ ...e, rank: i + 1 }));
        }
      } catch {
        return res.status(502).json({ error: "Failed to parse list from AI response. Please try again." });
      }

      const result: Top100Response = {
        category: cleanCategory,
        count: clampedCount,
        atlas: atlasRaw,
        entries
      };

      return res.json(result);
    } catch (err) {
      return next(err);
    }
  });

  return router;
};
