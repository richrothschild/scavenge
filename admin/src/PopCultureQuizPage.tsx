import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";

const apiBase =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.PROD
    ? "https://scavenge-backend-production.up.railway.app/api"
    : "http://localhost:3001/api");

type QuizQuestion = {
  id: number;
  question: string;
  options: string[];
  answer: string;
  topic: string;
};

type AnswerState = "unanswered" | "correct" | "wrong";

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const WITTY_REMARKS: { min: number; max: number; emoji: string; lines: string[] }[] = [
  {
    min: 100, max: 100, emoji: "🏆",
    lines: [
      "Perfect score. Either you lived through every decade twice, or you've been lying about your age.",
      "100%. You didn't miss a single one. Please step away from the children — you're making them feel bad.",
      "Flawless. We're going to need you to provide a blood sample and confirm you're not a time traveler.",
      "Perfect. You are essentially a human TV Guide from 1971. We mean that as a compliment.",
    ],
  },
  {
    min: 85, max: 99, emoji: "🌟",
    lines: [
      "Almost perfect. One wrong answer — which means you actually remember the 70s, and that's suspicious.",
      "So close. One slipped through. Don't lie — you're going to be thinking about that one in the shower.",
      "Nearly perfect. We assume the one you missed was during a bathroom break in 1968.",
      "Top tier. Whoever you are, the 60s and 70s clearly did not go to waste on you.",
    ],
  },
  {
    min: 70, max: 84, emoji: "🎉",
    lines: [
      "Solid. You clearly spent a lot of time in front of the TV instead of doing your homework. Worth it.",
      "Strong showing. You remember more of that decade than your liver probably wants you to.",
      "Well done. You've retained more useless pop culture knowledge than most people retain their own phone numbers.",
      "That's a B. Your parents would've said 'what happened to the other 20%' and then changed the channel.",
    ],
  },
  {
    min: 55, max: 69, emoji: "👍",
    lines: [
      "Not bad. You got more than half right, which puts you ahead of anyone born after 1990.",
      "More right than wrong. That's all anyone can really ask of a decade that smelled like that.",
      "Passing grade. You remembered enough to be dangerous at a dinner party and not much else.",
      "Just over the line. You know just enough to name-drop confidently and hope no one asks follow-up questions.",
    ],
  },
  {
    min: 40, max: 54, emoji: "🤔",
    lines: [
      "A coin flip would've matched that. But hey — at least you're consistent.",
      "Basically 50/50. Either you guessed brilliantly or you actually knew things. Hard to tell which is sadder.",
      "Right in the middle. You peaked exactly where mediocrity lives. It's cozy there.",
      "Half credit. The decade gave you a lot to work with, and you worked with approximately half of it.",
    ],
  },
  {
    min: 25, max: 39, emoji: "😬",
    lines: [
      "You were technically alive during some of this. Apparently that wasn't enough.",
      "Rough. You remembered less of the 60s and 70s than the people who were supposed to forget them.",
      "That score suggests you were either very young or very elsewhere. Either way: excuses accepted.",
      "Not great. But honestly, if you got through those decades unscathed, maybe it's a fair trade.",
    ],
  },
  {
    min: 1, max: 24, emoji: "💀",
    lines: [
      "This is genuinely impressive in the wrong direction. It takes talent to score this low on purpose.",
      "Wow. The 60s and 70s happened very publicly. There are photos. There are recordings. And yet.",
      "Almost zero. The one you got right was either a miracle or a misclick. We're not ruling either out.",
      "That score is lower than the ratings for most of the shows you apparently don't remember.",
    ],
  },
  {
    min: 0, max: 0, emoji: "🪦",
    lines: [
      "Zero. Not a single one. The 60s and 70s happened — we have receipts. Where were you?",
      "Zero out of 25. That is a complete and total shutout. The decade would like a word.",
      "Goose egg. Mathematically, guessing randomly should have gotten you two or three. This was worse than random.",
      "Nothing. Zilch. Not one. At this point we have to assume you did this on purpose, and honestly, respect.",
    ],
  },
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getWittyRemark(pct: number): { emoji: string; line: string } {
  const tier = WITTY_REMARKS.find((r) => pct >= r.min && pct <= r.max);
  if (!tier) return { emoji: "🤷", line: "Somewhere between legendary and lost. Hard to say." };
  return { emoji: tier.emoji, line: pick(tier.lines) };
}

function QuizQuestionCard({
  question,
  shuffledOptions,
  index,
  total,
  score,
  onAnswer,
  onSkip,
}: {
  question: QuizQuestion;
  shuffledOptions: string[];
  index: number;
  total: number;
  score: number;
  onAnswer: (option: string) => void;
  onSkip: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [answerState, setAnswerState] = useState<AnswerState>("unanswered");

  const handleAnswer = (option: string) => {
    if (answerState !== "unanswered") return;
    const correct = option === question.answer;
    setSelected(option);
    setAnswerState(correct ? "correct" : "wrong");
    setTimeout(() => onAnswer(option), 1400);
  };

  return (
    <div className="quiz-content">
      <div className="quiz-progress-bar">
        <div className="quiz-progress-fill" style={{ width: `${(index / total) * 100}%` }} />
      </div>

      <div className="quiz-meta-row">
        <span className="quiz-topic-chip">{question.topic}</span>
        <span className="quiz-score-chip">Score: {score}</span>
      </div>

      <div className="quiz-q-counter">{index + 1} / {total}</div>
      <p className="quiz-question">{question.question}</p>

      <div className="quiz-options">
        {shuffledOptions.map((option) => {
          let cls = "quiz-option-btn";
          if (answerState !== "unanswered") {
            if (option === question.answer) cls += " quiz-option-correct";
            else if (option === selected) cls += " quiz-option-wrong";
            else cls += " quiz-option-dim";
          }
          return (
            <button
              key={option}
              className={cls}
              onClick={() => handleAnswer(option)}
              disabled={answerState !== "unanswered"}
            >
              {option}
            </button>
          );
        })}
      </div>

      {answerState === "unanswered" && (
        <button className="quiz-skip-btn" onClick={onSkip}>
          Skip →
        </button>
      )}

      {answerState !== "unanswered" && (
        <div className={`quiz-feedback ${answerState === "correct" ? "quiz-feedback-correct" : "quiz-feedback-wrong"}`}>
          {answerState === "correct" ? "✓ Correct!" : `✗ ${question.answer}`}
        </div>
      )}
    </div>
  );
}

export default function PopCultureQuizPage() {
  const navigate = useNavigate();

  const [phase, setPhase] = useState<"start" | "loading" | "playing" | "done">("start");
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  // Pre-shuffle options once per question when the quiz loads
  const [shuffledOptionsList, setShuffledOptionsList] = useState<string[][]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [finalRemark, setFinalRemark] = useState<{ emoji: string; line: string } | null>(null);

  const fetchQuiz = async () => {
    setPhase("loading");
    setError(null);
    try {
      const res = await fetch(`${apiBase}/quiz/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? `Server error ${res.status}`);
      }
      const data = await res.json() as { questions: QuizQuestion[] };
      setQuestions(data.questions);
      setShuffledOptionsList(data.questions.map((q) => shuffled(q.options)));
      setCurrentIndex(0);
      setScore(0);
      setFinalRemark(null);
      setPhase("playing");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setPhase("start");
    }
  };

  const handleAnswer = useCallback((option: string) => {
    const current = questions[currentIndex];
    if (!current) return;
    const isCorrect = option === current.answer;
    if (isCorrect) setScore((s) => s + 1);
    if (currentIndex + 1 >= questions.length) {
      const finalScore = score + (isCorrect ? 1 : 0);
      const pct = Math.round((finalScore / questions.length) * 100);
      setFinalRemark(getWittyRemark(pct));
      setPhase("done");
    } else {
      setCurrentIndex((i) => i + 1);
    }
  }, [questions, currentIndex, score]);

  const handleSkip = useCallback(() => {
    if (currentIndex + 1 >= questions.length) {
      const pct = Math.round((score / questions.length) * 100);
      setFinalRemark(getWittyRemark(pct));
      setPhase("done");
    } else {
      setCurrentIndex((i) => i + 1);
    }
  }, [questions.length, currentIndex, score]);

  const currentQuestion = questions[currentIndex];

  // Start screen
  if (phase === "start") {
    return (
      <div className="pub-page">
        <header className="pub-header">
          <button className="pub-back" onClick={() => navigate("/")}>← Home</button>
          <h1>Pop Culture Quiz</h1>
        </header>
        <div className="quiz-start">
          <div className="quiz-start-icon">🕹️</div>
          <h2 className="quiz-start-title">60s &amp; 70s Pop Culture</h2>
          <p className="quiz-start-desc">
            25 questions covering cartoons, TV, movies, sports, politics,
            commercials, California, and more — all from the 60s and 70s.
          </p>
          <p className="quiz-start-desc quiz-start-note">
            A fresh set of questions is generated every game.
          </p>
          {error && <div className="quiz-error">{error}</div>}
          <button className="quiz-generate-btn" onClick={fetchQuiz}>
            Start Quiz
          </button>
        </div>
      </div>
    );
  }

  // Loading screen
  if (phase === "loading") {
    return (
      <div className="pub-page">
        <header className="pub-header">
          <button className="pub-back" onClick={() => navigate("/")}>← Home</button>
          <h1>Pop Culture Quiz</h1>
        </header>
        <div className="quiz-loading">
          <div className="top100-spinner" />
          <p>Generating your quiz…</p>
          <p className="quiz-loading-sub">Pulling from the 60s &amp; 70s vault</p>
        </div>
      </div>
    );
  }

  // Done screen
  if (phase === "done") {
    const total = questions.length;
    const pct = Math.round((score / total) * 100);
    const { emoji, line } = finalRemark ?? getWittyRemark(pct);
    return (
      <div className="pub-page">
        <header className="pub-header">
          <button className="pub-back" onClick={() => navigate("/")}>← Home</button>
          <h1>Pop Culture Quiz</h1>
        </header>
        <div className="quiz-done">
          <div className="quiz-done-emoji">{emoji}</div>
          <div className="quiz-done-score">{score} / {total}</div>
          <div className="quiz-done-label">correct</div>
          <div className="quiz-done-pct">{pct}%</div>
          <p className="quiz-done-witty">{line}</p>
          <button className="quiz-restart-btn" onClick={fetchQuiz}>
            New Quiz
          </button>
          <button className="quiz-home-btn" onClick={() => navigate("/")}>
            Home
          </button>
        </div>
      </div>
    );
  }

  // Playing
  if (!currentQuestion) return null;

  return (
    <div className="pub-page">
      <header className="pub-header">
        <button className="pub-back" onClick={() => navigate("/")}>← Home</button>
        <h1>Pop Culture Quiz</h1>
        <span className="pub-header-sub">60s &amp; 70s</span>
      </header>
      <QuizQuestionCard
        key={currentQuestion.id}
        question={currentQuestion}
        shuffledOptions={shuffledOptionsList[currentIndex] ?? currentQuestion.options}
        index={currentIndex}
        total={questions.length}
        score={score}
        onAnswer={handleAnswer}
        onSkip={handleSkip}
      />
    </div>
  );
}
