import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import rawQuizData from "./quiz-data.json";

type QuizEntry = {
  id: string;
  imageUrl: string;
  question: string;
  answer: string;
  options: string[];
};

const QUIZ_DATA = rawQuizData as QuizEntry[];

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

type AnswerState = "unanswered" | "correct" | "wrong";

export default function PopCultureQuizPage() {
  const navigate = useNavigate();

  const [questions] = useState<QuizEntry[]>(() => shuffle(QUIZ_DATA));
  const [currentIndex, setCurrentIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [answered, setAnswered] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [answerState, setAnswerState] = useState<AnswerState>("unanswered");
  const [done, setDone] = useState(false);
  const [imgError, setImgError] = useState(false);

  const current = questions[currentIndex];
  const total = questions.length;

  const advance = useCallback(() => {
    setSelected(null);
    setAnswerState("unanswered");
    setImgError(false);
    if (currentIndex + 1 >= total) {
      setDone(true);
    } else {
      setCurrentIndex((i) => i + 1);
    }
  }, [currentIndex, total]);

  const handleAnswer = useCallback(
    (option: string) => {
      if (answerState !== "unanswered" || !current) return;

      const correct = option === current.answer;
      setSelected(option);
      setAnswerState(correct ? "correct" : "wrong");
      setAnswered((a) => a + 1);
      if (correct) setScore((s) => s + 1);

      setTimeout(advance, 1400);
    },
    [answerState, current, advance]
  );

  const handleSkip = useCallback(() => {
    if (answerState !== "unanswered") return;
    advance();
  }, [answerState, advance]);

  const handleRestart = () => {
    setCurrentIndex(0);
    setScore(0);
    setAnswered(0);
    setSelected(null);
    setAnswerState("unanswered");
    setDone(false);
    setImgError(false);
  };

  if (total === 0) {
    return (
      <div className="pub-page">
        <header className="pub-header">
          <button className="pub-back" onClick={() => navigate("/")}>← Home</button>
          <h1>Pop Culture Quiz</h1>
        </header>
        <div className="quiz-empty">
          <p>No quiz questions yet.</p>
          <p className="quiz-empty-sub">Run the seed script to add images.</p>
        </div>
      </div>
    );
  }

  if (done) {
    const pct = Math.round((score / answered) * 100);
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
          <button className="quiz-restart-btn" onClick={handleRestart}>
            Play Again
          </button>
          <button className="quiz-home-btn" onClick={() => navigate("/")}>
            Home
          </button>
        </div>
      </div>
    );
  }

  if (!current) return null;

  return (
    <div className="pub-page">
      <header className="pub-header">
        <button className="pub-back" onClick={() => navigate("/")}>← Home</button>
        <h1>Pop Culture Quiz</h1>
        <span className="pub-header-sub">{currentIndex + 1} / {total}</span>
      </header>

      <div className="quiz-content">
        {/* Progress bar */}
        <div className="quiz-progress-bar">
          <div
            className="quiz-progress-fill"
            style={{ width: `${((currentIndex) / total) * 100}%` }}
          />
        </div>

        {/* Score chip */}
        <div className="quiz-score-chip">
          Score: {score}
        </div>

        {/* Image */}
        <div className="quiz-image-wrap">
          {!imgError ? (
            <img
              className="quiz-image"
              src={current.imageUrl}
              alt="Quiz image"
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="quiz-image-error">Image unavailable</div>
          )}
        </div>

        {/* Question */}
        <p className="quiz-question">{current.question}</p>

        {/* Options */}
        <div className="quiz-options">
          {current.options.map((option) => {
            let cls = "quiz-option-btn";
            if (answerState !== "unanswered") {
              if (option === current.answer) {
                cls += " quiz-option-correct";
              } else if (option === selected) {
                cls += " quiz-option-wrong";
              } else {
                cls += " quiz-option-dim";
              }
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

        {/* Skip */}
        {answerState === "unanswered" && (
          <button className="quiz-skip-btn" onClick={handleSkip}>
            Skip →
          </button>
        )}

        {/* Feedback */}
        {answerState !== "unanswered" && (
          <div className={`quiz-feedback ${answerState === "correct" ? "quiz-feedback-correct" : "quiz-feedback-wrong"}`}>
            {answerState === "correct" ? "✓ Correct!" : `✗ The answer is ${current.answer}`}
          </div>
        )}
      </div>
    </div>
  );
}
