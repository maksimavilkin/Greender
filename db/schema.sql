BEGIN;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  first_name VARCHAR(80) NOT NULL,
  last_name VARCHAR(80) NOT NULL,
  patronymic VARCHAR(80),
  email VARCHAR(255),
  phone VARCHAR(30),
  password_hash TEXT NOT NULL,
  city VARCHAR(100) NOT NULL DEFAULT 'Москва',
  role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (NULLIF(BTRIM(email),'') IS NOT NULL OR NULLIF(BTRIM(phone),'') IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (LOWER(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique ON users (phone) WHERE phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS categories (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  creator_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  category_id BIGINT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  title VARCHAR(180) NOT NULL,
  description TEXT NOT NULL,
  city VARCHAR(100) NOT NULL,
  location VARCHAR(255) NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  volunteers_needed INTEGER NOT NULL DEFAULT 1 CHECK (volunteers_needed > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','cancelled','completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS events_feed_idx ON events (city, status, starts_at);
CREATE INDEX IF NOT EXISTS events_category_idx ON events (category_id, status, starts_at);
CREATE INDEX IF NOT EXISTS events_creator_idx ON events (creator_id, created_at DESC);

CREATE TABLE IF NOT EXISTS event_participants (
  event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'joined' CHECK (status IN ('joined','cancelled','attended')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id,user_id)
);
CREATE INDEX IF NOT EXISTS event_participants_user_idx ON event_participants (user_id,status,joined_at DESC);

CREATE TABLE IF NOT EXISTS event_favorites (
  event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id,user_id)
);
CREATE INDEX IF NOT EXISTS event_favorites_user_idx ON event_favorites (user_id,created_at DESC);

INSERT INTO categories(name,description) VALUES
 ('Экология','Уборка территорий, озеленение и защита природы'),
 ('Животные','Помощь приютам и животным'),
 ('Помощь людям','Волонтёрская помощь людям и учреждениям'),
 ('Дети','Помощь детям и детским учреждениям'),
 ('Другое','Другие добрые дела')
ON CONFLICT(name) DO NOTHING;

COMMIT;
