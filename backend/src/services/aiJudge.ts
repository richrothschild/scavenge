export type AIJudgeVerdict = "PASS" | "FAIL" | "NEEDS_REVIEW";

export type AIJudgeResult = {
  verdict: AIJudgeVerdict;
  score: number;
  reasons: string[];
  safety_flags: string[];
  notes_for_admin: string;
};

export type JudgeInput = {
  clueTitle: string;
  clueInstructions: string;
  clueRubric: string;
  submissionType: "PHOTO" | "VIDEO" | "TEXT" | "NONE";
  textContent?: string;
  mediaUrl?: string;
  expectedAnswer?: string;
  similarityThreshold?: number;
};

export interface AIJudgeProvider {
  judge(input: JudgeInput): Promise<AIJudgeResult>;
}

const DEFAULT_SIMILARITY_THRESHOLD = 0.5;

const normalizeForComparison = (value: string) => {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const getBigrams = (value: string) => {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length < 2) {
    return compact ? [compact] : [];
  }

  const bigrams: string[] = [];
  for (let index = 0; index < compact.length - 1; index += 1) {
    bigrams.push(compact.slice(index, index + 2));
  }
  return bigrams;
};

const diceCoefficient = (left: string, right: string) => {
  if (!left && !right) return 1;
  if (!left || !right) return 0;
  if (left === right) return 1;

  const leftBigrams = getBigrams(left);
  const rightBigrams = getBigrams(right);
  if (leftBigrams.length === 0 || rightBigrams.length === 0) {
    return 0;
  }

  const rightCounts = new Map<string, number>();
  for (const gram of rightBigrams) {
    rightCounts.set(gram, (rightCounts.get(gram) ?? 0) + 1);
  }

  let intersection = 0;
  for (const gram of leftBigrams) {
    const count = rightCounts.get(gram) ?? 0;
    if (count > 0) {
      intersection += 1;
      rightCounts.set(gram, count - 1);
    }
  }

  return (2 * intersection) / (leftBigrams.length + rightBigrams.length);
};

const answerSimilarity = (expected: string, provided: string) => {
  const normalizedExpected = normalizeForComparison(expected);
  const normalizedProvided = normalizeForComparison(provided);
  if (!normalizedExpected || !normalizedProvided) {
    return 0;
  }

  const expectedTokens = new Set(normalizedExpected.split(" ").filter(Boolean));
  const providedTokens = new Set(normalizedProvided.split(" ").filter(Boolean));

  let overlap = 0;
  for (const token of expectedTokens) {
    if (providedTokens.has(token)) {
      overlap += 1;
    }
  }

  const tokenContainment = expectedTokens.size > 0 ? overlap / expectedTokens.size : 0;
  const textSimilarity = diceCoefficient(normalizedExpected, normalizedProvided);

  return Math.max(tokenContainment, textSimilarity);
};

class MockAIJudgeProvider implements AIJudgeProvider {
  async judge(input: JudgeInput): Promise<AIJudgeResult> {
    const normalizedText = (input.textContent ?? "").toLowerCase();
    const hasEvidence = Boolean(input.mediaUrl || input.textContent);
    const expectedAnswer = input.expectedAnswer?.trim() ?? "";
    const threshold = Number.isFinite(input.similarityThreshold)
      ? Math.max(0, Math.min(1, Number(input.similarityThreshold)))
      : DEFAULT_SIMILARITY_THRESHOLD;

    if (!hasEvidence) {
      return {
        verdict: "FAIL",
        score: 0,
        reasons: ["No submission evidence provided."],
        safety_flags: ["NONE"],
        notes_for_admin: "Auto-failed due to missing media/text."
      };
    }

    // Expected answer check runs before media routing so it always gates text answers
    if (expectedAnswer) {
      const providedAnswer = input.textContent?.trim() ?? "";
      if (!providedAnswer) {
        return {
          verdict: "FAIL",
          score: 0,
          reasons: [
            "Answer text is required for this clue.",
            "Please enter your answer and resubmit."
          ],
          safety_flags: ["NONE"],
          notes_for_admin: "Auto-failed due to missing answer text for clue with expected answer."
        };
      }

      const similarity = answerSimilarity(expectedAnswer, providedAnswer);
      if (similarity < threshold) {
        const similarityPercent = Math.round(similarity * 100);
        const thresholdPercent = Math.round(threshold * 100);
        return {
          verdict: "FAIL",
          score: Math.max(0, similarityPercent),
          reasons: [
            `Answer incorrect. Your response is ${similarityPercent}% similar; at least ${thresholdPercent}% is required.`,
            "Please revise your answer and resubmit."
          ],
          safety_flags: ["NONE"],
          notes_for_admin: `Auto-failed answer similarity check (${similarityPercent}% < ${thresholdPercent}%).`
        };
      }

      // Similarity passed — return PASS immediately so media routing cannot override it
      return {
        verdict: "PASS",
        score: Math.round(Math.min(similarity, 1) * 100),
        reasons: ["Answer matches the expected response."],
        safety_flags: ["NONE"],
        notes_for_admin: `Answer similarity check passed (${Math.round(similarity * 100)}%).`
      };
    }

    // Mock cannot evaluate real uploaded media — route to admin review when a media file was provided
    if (input.mediaUrl && (input.submissionType === "PHOTO" || input.submissionType === "VIDEO")) {
      return {
        verdict: "NEEDS_REVIEW",
        score: 50,
        reasons: ["Photo/video submission received and is awaiting admin review."],
        safety_flags: ["NONE"],
        notes_for_admin: "Mock AI provider cannot evaluate media. Manual admin review required."
      };
    }

    if (normalizedText.includes("review")) {
      return {
        verdict: "NEEDS_REVIEW",
        score: 50,
        reasons: ["Submission requested manual review keyword."],
        safety_flags: ["NONE"],
        notes_for_admin: "Flagged by deterministic mock rule."
      };
    }

    if (normalizedText.includes("fail")) {
      return {
        verdict: "FAIL",
        score: 20,
        reasons: ["Submission content indicates unmet clue requirements."],
        safety_flags: ["NONE"],
        notes_for_admin: "Deterministic mock failure."
      };
    }

    return {
      verdict: "PASS",
      score: 85,
      reasons: ["Submission includes required evidence for mock rubric evaluation."],
      safety_flags: ["NONE"],
      notes_for_admin: "Auto-pass from mock provider."
    };
  }
}

const OPENAI_JUDGE_SYSTEM_PROMPT = `You are a fair and objective scavenger hunt judge for a city-wide team event. Evaluate whether the submitted evidence satisfies the clue requirements and rubric.

Respond ONLY with valid JSON in this exact format (no markdown, no extra text):
{
  "verdict": "PASS" | "FAIL" | "NEEDS_REVIEW",
  "score": <integer 0-100>,
  "reasons": ["<reason>", ...],
  "safety_flags": ["NONE"] | ["<flag>", ...],
  "notes_for_admin": "<string>"
}

Verdict guidelines:
- PASS (score 1-100): Evidence satisfies the clue requirements in any meaningful way
- FAIL (score 0): Evidence clearly does NOT satisfy the clue requirements at all
- NEEDS_REVIEW (score 0, only if truly unable to evaluate): Evidence is completely unreadable or unrelated; admin should verify

Safety flags: use ["NONE"] if no concerns. Otherwise list issues like INAPPROPRIATE_CONTENT, WRONG_LOCATION, APPEARS_STAGED.`;

type OpenAIMessagePart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

class OpenAIJudgeProvider implements AIJudgeProvider {
  constructor(private readonly apiKey: string, private readonly model: string) {}

  async judge(input: JudgeInput): Promise<AIJudgeResult> {
    // Deterministic similarity check for text clues with known answers
    if (input.expectedAnswer?.trim()) {
      const expectedAnswer = input.expectedAnswer.trim();
      const providedAnswer = input.textContent?.trim() ?? "";
      const threshold = Number.isFinite(input.similarityThreshold)
        ? Math.max(0, Math.min(1, Number(input.similarityThreshold)))
        : DEFAULT_SIMILARITY_THRESHOLD;

      if (!providedAnswer) {
        return {
          verdict: "FAIL",
          score: 0,
          reasons: ["Answer text is required for this clue.", "Please enter your answer and resubmit."],
          safety_flags: ["NONE"],
          notes_for_admin: "Auto-failed: missing answer text for clue with expected answer."
        };
      }

      const similarity = answerSimilarity(expectedAnswer, providedAnswer);
      if (similarity < threshold) {
        const similarityPercent = Math.round(similarity * 100);
        const thresholdPercent = Math.round(threshold * 100);
        return {
          verdict: "FAIL",
          score: Math.max(0, similarityPercent),
          reasons: [
            `Answer incorrect. Your response is ${similarityPercent}% similar; at least ${thresholdPercent}% is required.`,
            "Please revise your answer and resubmit."
          ],
          safety_flags: ["NONE"],
          notes_for_admin: `Auto-failed answer similarity check (${similarityPercent}% < ${thresholdPercent}%).`
        };
      }

      // Passes similarity — no need to invoke the AI API for known-answer text clues
      return {
        verdict: "PASS",
        score: Math.round(Math.min(similarity, 1) * 100),
        reasons: ["Answer matches the expected response."],
        safety_flags: ["NONE"],
        notes_for_admin: `Answer similarity check passed (${Math.round(similarity * 100)}%).`
      };
    }

    // Photo/video without a URL means we never received the media
    if ((input.submissionType === "PHOTO" || input.submissionType === "VIDEO") && !input.mediaUrl) {
      return {
        verdict: "NEEDS_REVIEW",
        score: 50,
        reasons: ["Media submission received; please check with admin."],
        safety_flags: ["NONE"],
        notes_for_admin: "Media URL not present; AI evaluation skipped. Manual review required."
      };
    }

    const clueContext = [
      `Clue: "${input.clueTitle}"`,
      `Instructions: ${input.clueInstructions}`,
      `Rubric: ${input.clueRubric || "Standard scavenger hunt completion criteria apply."}`,
      `Submission type: ${input.submissionType}`
    ].join("\n");

    const parts: OpenAIMessagePart[] = [{ type: "text", text: clueContext }];
    if (input.textContent?.trim()) {
      parts.push({ type: "text", text: `Team's text submission: "${input.textContent.trim()}"` });
    }
    if (input.mediaUrl) {
      parts.push({ type: "image_url", image_url: { url: input.mediaUrl } });
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: OPENAI_JUDGE_SYSTEM_PROMPT },
          { role: "user", content: parts }
        ],
        response_format: { type: "json_object" },
        max_tokens: 512,
        temperature: 0.2
      })
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "(no body)");
      throw new Error(`OpenAI API error ${response.status}: ${errorBody}`);
    }

    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    const raw = data.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as Partial<AIJudgeResult>;

    const validVerdicts: AIJudgeVerdict[] = ["PASS", "FAIL", "NEEDS_REVIEW"];
    return {
      verdict: validVerdicts.includes(parsed.verdict as AIJudgeVerdict)
        ? (parsed.verdict as AIJudgeVerdict)
        : "NEEDS_REVIEW",
      score: typeof parsed.score === "number" ? Math.max(0, Math.min(100, Math.round(parsed.score))) : 50,
      reasons: Array.isArray(parsed.reasons)
        ? parsed.reasons.filter((r): r is string => typeof r === "string")
        : ["AI evaluation completed."],
      safety_flags: Array.isArray(parsed.safety_flags)
        ? parsed.safety_flags.filter((f): f is string => typeof f === "string")
        : ["NONE"],
      notes_for_admin:
        typeof parsed.notes_for_admin === "string" ? parsed.notes_for_admin : ""
    };
  }
}

export const createAIJudgeProvider = (provider: "openai" | "anthropic" | "mock", apiKey?: string, model?: string): AIJudgeProvider => {
  if (provider === "openai") {
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required when AI_PROVIDER=openai");
    }
    return new OpenAIJudgeProvider(apiKey, model ?? "gpt-4o");
  }
  return new MockAIJudgeProvider();
};
