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
};

export interface AIJudgeProvider {
  judge(input: JudgeInput): Promise<AIJudgeResult>;
}

class MockAIJudgeProvider implements AIJudgeProvider {
  async judge(input: JudgeInput): Promise<AIJudgeResult> {
    const normalizedText = (input.textContent ?? "").toLowerCase();
    const hasEvidence = Boolean(input.mediaUrl || input.textContent);

    if (!hasEvidence) {
      return {
        verdict: "FAIL",
        score: 0,
        reasons: ["No submission evidence provided."],
        safety_flags: ["NONE"],
        notes_for_admin: "Auto-failed due to missing media/text."
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

export const createAIJudgeProvider = (_provider: "openai" | "anthropic" | "mock") => {
  return new MockAIJudgeProvider();
};
