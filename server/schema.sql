-- everyone who has ever opened the game
CREATE TABLE IF NOT EXISTS players (
  pid    TEXT PRIMARY KEY,
  name   TEXT NOT NULL DEFAULT '',
  names  TEXT NOT NULL DEFAULT '[]',   -- every name this player has used
  dev    TEXT NOT NULL DEFAULT '',     -- iphone / android / apk / pc
  ver    INTEGER NOT NULL DEFAULT 0,
  grp    TEXT NOT NULL DEFAULT '',     -- company code
  mode   TEXT NOT NULL DEFAULT '',     -- menu / bots / table
  tg     INTEGER NOT NULL DEFAULT 0,   -- Telegram is linked
  first  INTEGER NOT NULL,
  last   INTEGER NOT NULL,
  visits INTEGER NOT NULL DEFAULT 0,
  games  INTEGER NOT NULL DEFAULT 0,
  room   TEXT NOT NULL DEFAULT '',     -- the room the player is in now
  kind   TEXT NOT NULL DEFAULT '',     -- short / long: the game being played now
  host   INTEGER NOT NULL DEFAULT 0    -- this player's device keeps the room
);
-- the Telegram chat of a player who pressed Start in the bot
CREATE TABLE IF NOT EXISTS tg (
  pid  TEXT PRIMARY KEY,
  chat INTEGER NOT NULL,
  at   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
