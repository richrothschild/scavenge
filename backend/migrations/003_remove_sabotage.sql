DROP TABLE IF EXISTS sabotage_purchases;
DROP TABLE IF EXISTS sabotage_actions;

ALTER TABLE teams
  DROP COLUMN IF EXISTS sabotage_balance;
