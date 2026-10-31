-- Каталог и личная библиотека пользователя (избранное, статус, прогресс)

CREATE TABLE anime (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  year INTEGER NOT NULL,
  episodes INTEGER NOT NULL,
  -- Сколько серий уже вышло: для ленты обновлений
  episodes_aired INTEGER NOT NULL,
  rating REAL NOT NULL,
  -- JSON-массив жанров
  genres TEXT NOT NULL,
  voice TEXT NOT NULL,
  symbol TEXT NOT NULL,
  -- CSS-градиент постера
  poster TEXT NOT NULL,
  description TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE library (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  anime_id INTEGER NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
  favorite INTEGER NOT NULL DEFAULT 0,
  status TEXT CHECK (status IN ('planned', 'watching', 'completed', 'dropped')),
  -- Сколько серий просмотрено
  episode INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, anime_id)
);

-- Демонстрационный каталог. Названия студий озвучки выдуманные:
-- раньше здесь стояли реальные группы, и это вводило в заблуждение
INSERT INTO anime (id, title, year, episodes, episodes_aired, rating, genres, voice, symbol, poster, description, updated_at) VALUES
  (1, 'Звёздный странник', 2025, 12, 9, 9.2, '["Фантастика","Экшен"]', 'Студия «Комета»', '✦',
   'linear-gradient(145deg, #263c78, #a95287 56%, #f1c676)',
   'Юная команда отправляется за пределы знакомой галактики, чтобы найти пропавший корабль-маяк.', '2026-10-30 18:00:00'),
  (2, 'Лунный сад', 2024, 24, 24, 8.8, '["Романтика","Фэнтези"]', 'Тихий эфир', '☾',
   'linear-gradient(145deg, #17264f, #6652a5 50%, #dc8eb1)',
   'История о встрече двух людей в городе, который живёт только ночью.', '2026-09-12 20:00:00'),
  (3, 'Город героев', 2025, 13, 7, 8.9, '["Экшен","Комедия"]', 'Neon Voice', '⚡',
   'linear-gradient(145deg, #152b38, #168a9b 55%, #f1bc6c)',
   'Обычный школьник получает силу, о которой мечтал весь город, и не знает, что с ней делать.', '2026-10-29 19:30:00'),
  (4, 'После дождя', 2023, 11, 11, 8.5, '["Драма","Романтика"]', 'Лунный дубляж', '☔',
   'linear-gradient(145deg, #304b67, #688eb4 55%, #d47b88)',
   'Тихая история о взрослении, дружбе и втором шансе.', '2026-05-02 17:00:00'),
  (5, 'Печать дракона', 2024, 25, 18, 9.0, '["Фэнтези","Экшен"]', 'Студия «Комета»', '♢',
   'linear-gradient(145deg, #42204b, #a53555 56%, #efb755)',
   'Наследник древней силы должен спасти королевство от наступающей тьмы.', '2026-10-27 21:00:00'),
  (6, 'Кафе на краю мира', 2025, 10, 4, 8.4, '["Комедия","Фэнтези"]', 'Тихий эфир', '☕',
   'linear-gradient(145deg, #483137, #bc715e 54%, #f4d18a)',
   'Каждую ночь в маленьком кафе встречаются необычные гости из разных миров.', '2026-10-31 10:00:00'),
  (7, 'Нулевая орбита', 2024, 12, 12, 8.7, '["Фантастика","Драма"]', 'Neon Voice', '◎',
   'linear-gradient(145deg, #16213b, #396c9f 54%, #8bd0cb)',
   'Экипаж исследовательской станции пытается изменить собственное прошлое.', '2026-08-20 18:00:00'),
  (8, 'Секретный клуб', 2023, 12, 12, 8.2, '["Комедия","Романтика"]', 'Лунный дубляж', '♡',
   'linear-gradient(145deg, #5b315b, #c66c91 55%, #f5c477)',
   'Четверо друзей открывают школьный клуб, который быстро выходит из-под контроля.', '2026-03-15 16:00:00');
