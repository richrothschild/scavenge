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

function QuizQuestion({
  question,
  index,
  total,
  score,
  onAnswer,
  onSkip,
}: {
  question: QuizQuestion;
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
        {question.options.map((option) => {
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
  const [currentIndex, setCurrentIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [error, setError] = useState<string | null>(null);

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
      setCurrentIndex(0);
      setScore(0);
      setPhase("playing");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setPhase("start");
    }
  };

  const handleAnswer = useCallback((option: string) => {
    const current = questions[currentIndex];
    if (!current) return;
    if (option === current.answer) setScore((s) => s + 1);
    if (currentIndex + 1 >= questions.length) {
      setPhase("done");
    } else {
      setCurrentIndex((i) => i + 1);
    }
  }, [questions, currentIndex]);

  const handleSkip = useCallback(() => {
    if (currentIndex + 1 >= questions.length) {
      setPhase("done");
    } else {
      setCurrentIndex((i) => i + 1);
    }
  }, [questions.length, currentIndex]);

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
    const emoji = pct >= 80 ? "🏆" : pct >= 60 ? "🎉" : pct >= 40 ? "👍" : "😅";
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
      <QuizQuestion
        key={currentQuestion.id}
        question={currentQuestion}
        index={currentIndex}
        total={questions.length}
        score={score}
        onAnswer={handleAnswer}
        onSkip={handleSkip}
      />
    </div>
  );
}
