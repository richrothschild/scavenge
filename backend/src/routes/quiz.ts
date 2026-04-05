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

const SYSTEM_PROMPT = `You are a pop culture trivia expert specializing in American life during the 1960s and 1970s. Generate exactly 25 multiple choice quiz questions for a group of true experts who grew up in this era.

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

DIFFICULTY: These players will ace anything easy. Every question must be genuinely hard — the kind that makes someone say "oh wow, I should know this." Target the bottom 20% of knowledge for a true superfan, not the top 80%.

Good question types (use these):
- "Which musician guested on which specific Grateful Dead show or album track?"
- "What was the name of [minor supporting character] on [show]?"
- "Who voiced [specific secondary character] in [cartoon]?"
- "What was the B-side of [hit single]?"
- "Who was [president]'s [specific staff role]?"
- "Which obscure player [did specific thing] in [specific game or season]?"
- "What year did [specific minor event] happen?"
- "What was the original name of [band] before they became famous?"
- "Which commercial used the jingle [partial lyric]?"
- "What city/venue hosted [specific concert or event]?"

Bad question types (NEVER use these — too easy):
- Who was president during [major event]?
- Who played lead guitar for [famous band]?
- What year did [massive cultural milestone] happen?
- Who starred in [blockbuster movie everyone knows]?
- What team won [famous championship everyone remembers]?
- Anything where the answer is in the question text

ANSWER LEAKING RULE — CRITICAL:
Never include any word from the correct answer inside the question text. If the answer is "H.R. Haldeman", the question must not contain "Haldeman". If the answer is "Sugar Ray Leonard", the question must not contain "Leonard" or "Sugar Ray". Read the question and answer together and verify zero overlap before including it.

Wrong options rules:
- Must be real people, places, or things from the same era and domain
- Must require actual knowledge to eliminate — not obviously wrong
- All four options should look equally plausible to someone who half-knows the topic

Other rules:
- Exactly 25 questions, numbered 1 through 25
- Each question has exactly 4 options
- The "answer" field must exactly match one of the 4 options
- Spread questions evenly across the provided topics
- No duplicate questions
- Questions must be factually accurate — do not invent statistics or events`;

async function generateQuiz(
  apiKey: string,
  model: string,
  topics: string[]
): Promise<QuizQuestion[]> {
  const topicList = topics.map((t, i) => `${i + 1}. ${t}`).join("\n");
  const userPrompt = `Generate 25 EXPERT-LEVEL pop culture trivia questions about American life in the 1960s and 1970s. These are for people who lived through the era and know it deeply. Draw from these topics:\n\n${topicList}\n\nExamples of the RIGHT difficulty level:\n- "Which pianist sat in with the Grateful Dead at the 1970 Fillmore East run?" (not "Who was the Grateful Dead's lead guitarist?")\n- "What was the name of Speed Racer's car?" (not "Who voiced Speed Racer?")\n- "Who was Nixon's first chief of staff?" (not "Who was Nixon's vice president?")\n- "What was the B-side of the Beatles' 'Hey Jude'?" (not "What year did the Beatles break up?")\n- "Which Dodger pitcher threw the only perfect game in World Series history?" (not "Who won the 1969 World Series?")\n\nRemember: zero words from the correct answer may appear in the question text. Verify this for every single question before including it.\n\nReturn exactly 25 questions in the required JSON format.`;

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

  const STOP_WORDS = new Set([
    "the","a","an","of","in","on","at","to","for","with","by","as","was","is","are",
    "were","had","has","have","he","she","it","his","her","its","who","what","which",
    "that","this","these","those","and","or","but","not","be","been","from","did",
    "do","does","how","when","where","their","they","them","we","us","you","your"
  ]);

  function answerLeaksIntoQuestion(question: string, answer: string): boolean {
    const normalize = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
    const answerWords = normalize(answer).filter((w) => w.length > 2 && !STOP_WORDS.has(w));
    const questionWords = new Set(normalize(question));
    return answerWords.some((w) => questionWords.has(w));
  }

  const mapped = (parsed.questions as Record<string, unknown>[]).map((q, i) => ({
    id: typeof q.id === "number" ? q.id : i + 1,
    question: typeof q.question === "string" ? q.question : "",
    options: Array.isArray(q.options)
      ? (q.options as unknown[]).filter((o): o is string => typeof o === "string").slice(0, 4)
      : [],
    answer: typeof q.answer === "string" ? q.answer : "",
    topic: typeof q.topic === "string" ? q.topic : "General",
  })).filter((q) => {
    if (!q.question || q.options.length !== 4 || !q.answer) return false;
    if (answerLeaksIntoQuestion(q.question, q.answer)) {
      console.warn(`[quiz] Dropped answer-leak question: "${q.question.slice(0, 60)}..." answer="${q.answer}"`);
      return false;
    }
    return true;
  });

  return mapped;
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
