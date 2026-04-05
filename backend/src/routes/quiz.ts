import { Router } from "express";

export type QuizQuestion = {
  id: number;
  question: string;
  options: string[];
  answer: string;
  topic: string;
};

export type QuizResponse = {
  questions: QuizQuestion[];
};

const TOPICS = [
  "Saturday morning cartoons of the 1960s and 1970s",
  "US politics and presidents of the 1960s and 1970s",
  "Major US sports (NFL, MLB, NBA, boxing) in the 1960s and 1970s",
  "California culture and news in the 1960s and 1970s",
  "Redwood City, California in the 1960s and 1970s",
  "Sunnyvale, California and Silicon Valley in the 1960s and 1970s",
  "Hollywood movies of the 1960s and 1970s",
  "American TV shows of the 1960s and 1970s",
  "Famous TV commercials and advertising slogans of the 1960s and 1970s",
  "Rock and roll of the 1960s and 1970s (British Invasion, classic rock, guitar legends)",
  "Pop music hits and artists of the 1960s and 1970s",
  "The Grateful Dead — history, members, songs, tours, and culture",
  "News and world events as seen from America in the 1960s and 1970s",
  "American fads, toys, and pop culture trends of the 1960s and 1970s",
];

const SYSTEM_PROMPT = `You are a pop culture trivia expert specializing in American life during the 1960s and 1970s. Generate exactly 25 multiple choice quiz questions.

Respond ONLY with valid JSON in this exact format (no markdown, no extra text):
{
  "questions": [
    {
      "id": 1,
      "question": "question text here",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "answer": "the exact correct option text",
      "topic": "short topic label"
    }
  ]
}

Rules:
- Exactly 25 questions, numbered 1 through 25
- Each question has exactly 4 options
- The "answer" field must exactly match one of the 4 options
- Spread questions across the provided topics — do not cluster too many in one area
- Questions should be fun, nostalgic, and suitable for men who grew up in the 60s and 70s
- Mix easy, medium, and hard difficulty
- No duplicate questions
- Keep questions concise and unambiguous
- Wrong options should be plausible but clearly wrong to someone who lived through the era`;

async function generateQuiz(
  apiKey: string,
  model: string,
  topics: string[]
): Promise<QuizQuestion[]> {
  const topicList = topics.map((t, i) => `${i + 1}. ${t}`).join("\n");
  const userPrompt = `Generate 25 pop culture trivia questions about American life in the 1960s and 1970s. Draw from these topics (spread questions across them):\n\n${topicList}\n\nReturn exactly 25 questions in the required JSON format.`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      max_tokens: 4000,
      temperature: 0.8,
    }),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => "(no body)");
    throw new Error(`OpenAI API error ${response.status}: ${err}`);
  }

  const data = await response.json() as { choices: Array<{ message: { content: string } }> };
  const raw = data.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as { questions?: unknown[] };

  if (!Array.isArray(parsed.questions)) {
    throw new Error("Invalid response format from OpenAI");
  }

  return (parsed.questions as Record<string, unknown>[]).map((q, i) => ({
    id: typeof q.id === "number" ? q.id : i + 1,
    question: typeof q.question === "string" ? q.question : "",
    options: Array.isArray(q.options)
      ? (q.options as unknown[]).filter((o): o is string => typeof o === "string").slice(0, 4)
      : [],
    answer: typeof q.answer === "string" ? q.answer : "",
    topic: typeof q.topic === "string" ? q.topic : "General",
  })).filter((q) => q.question && q.options.length === 4 && q.answer);
}

export const createQuizRouter = (openaiApiKey: string | undefined, openaiModel: string) => {
  const router = Router();

  router.post("/quiz/generate", async (req, res, next) => {
    try {
      if (!openaiApiKey) {
        return res.status(503).json({ error: "OpenAI API key is not configured on this server." });
      }

      const questions = await generateQuiz(openaiApiKey, openaiModel, TOPICS);

      return res.json({ questions } as QuizResponse);
    } catch (err) {
      return next(err);
    }
  });

  return router;
};
