export type GameStatus = "PENDING" | "RUNNING" | "PAUSED" | "ENDED";

export type TeamName = "SPADES" | "HEARTS" | "DIAMONDS" | "CLUBS";

export interface TeamProgress {
  teamId: string;
  teamName: TeamName;
  scoreTotal: number;
  currentClueIndex: number;
  completedCount: number;
  skippedCount: number;
  eligibilityStatus: "ELIGIBLE" | "INELIGIBLE";
}
